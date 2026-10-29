import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseComposeInput } from "@demo-wall/agent-core";
import {
  activeTraceIds,
  addCount,
  annotateLog,
  log,
  parseJson,
  randomHex,
  runWithLogContext,
  withSpan,
} from "@demo-wall/observability";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { DatabaseSync } from "node:sqlite";

import { agentHeaders, endpoint, requestPlacement } from "./agent-client.js";
import {
  clearSessionCookie,
  hashPassword,
  passwordProblem,
  readCookie,
  sessionCookie,
  validName,
  verifyPassword,
} from "./auth.js";
import {
  createDraft,
  createSession,
  createUser,
  deleteSession,
  findDraft,
  findSession,
  findUserByName,
  listBoards,
  listPosters,
  markDraftFailed,
  markDraftReady,
  newId,
  publishPoster,
  type Draft,
  type Poster,
  type PublicUser,
} from "./db.js";
import { jsonStringField, parseSseChunk } from "./sse.js";

const GROUP_ORDER = ["say it loud", "keep it close", "pass it on"];
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const CATEGORY = /^[a-z0-9-]{1,40}$/;

type WallEnv = {
  Variables: {
    user: PublicUser;
    sessionId: string;
  };
};

export type WallOptions = {
  db: DatabaseSync;
  agentUrl: string;
  internalToken: string;
  fetchImpl?: typeof fetch;
};

type PublicFiles = {
  index: string;
  css: string;
  script: string;
  icon: string;
};

export function createWallApp(options: WallOptions): Hono<WallEnv> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const files = loadPublic();
  const app = new Hono<WallEnv>();

  app.onError((error, c) => {
    log({ severity: "ERROR", body: error.message, event: "http.error" });
    return c.json({ ok: false, error: "internal", message: "something broke on our side" }, 500);
  });

  app.use("*", async (c, next) => {
    const started = Date.now();
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    c.header("x-frame-options", "DENY");
    await withSpan("http.request", async (span) => {
      span.setAttribute("http.request.method", c.req.method);
      span.setAttribute("url.path", c.req.path);
      const active = activeTraceIds();
      await runWithLogContext(
        {
          traceId: active?.traceId ?? randomHex(16),
          spanId: active?.spanId ?? randomHex(8),
          attributes: {},
        },
        async () => {
          try {
            await next();
            log({
              severity: "INFO",
              body: "request complete",
              event: "http.request",
              attributes: {
                "http.method": c.req.method,
                "http.route": c.req.path,
                "http.status": c.res.status,
                "duration.ms": Date.now() - started,
              },
            });
          } catch (error) {
            log({
              severity: "ERROR",
              body: "request failed",
              event: "http.error",
              attributes: {
                "http.method": c.req.method,
                "http.route": c.req.path,
                "http.status": 500,
                "duration.ms": Date.now() - started,
              },
            });
            throw error;
          }
        },
      );
    });
  });

  app.get("/health", (c) => c.json({ ok: true, service: "wall" }));

  app.post("/api/signup", async (c) => {
    const creds = await readCredentials(c);
    if (!creds.ok) return problem(c, 400, "bad_request", creds.message);
    const created = createUser(options.db, {
      id: newId("usr"),
      displayName: creds.displayName,
      passwordHash: await hashPassword(creds.password),
      createdAt: new Date().toISOString(),
    });
    if (!created.ok) return problem(c, 409, "taken", "that name is already on the wall");
    const user = findUserByName(options.db, creds.displayName);
    if (!user) return problem(c, 500, "internal", "something broke on our side");
    const sessionId = createSession(options.db, user.id);
    c.header("set-cookie", sessionCookie(sessionId));
    log({ severity: "INFO", body: "signed up", event: "auth.signup", attributes: { "user.id": user.id } });
    return c.json({ ok: true, user: publicUser(user) });
  });

  app.post("/api/login", async (c) => {
    const creds = await readCredentials(c);
    if (!creds.ok) return problem(c, 400, "bad_request", creds.message);
    const user = findUserByName(options.db, creds.displayName);
    const hash = user?.passwordHash ?? (await hashPassword("not-a-real-password"));
    const matches = await verifyPassword(creds.password, hash);
    if (!user || !matches) {
      log({ severity: "INFO", body: "login failed", event: "auth.login.failed" });
      return problem(c, 401, "unauthorized", "that name or password does not match");
    }
    const sessionId = createSession(options.db, user.id);
    c.header("set-cookie", sessionCookie(sessionId));
    log({ severity: "INFO", body: "logged in", event: "auth.login", attributes: { "user.id": user.id } });
    return c.json({ ok: true, user: publicUser(user) });
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/signup" || c.req.path === "/api/login") {
      await next();
      return;
    }
    const sessionId = readCookie(c.req.header("cookie"), "wall_session");
    if (!sessionId || !ID.test(sessionId)) return problem(c, 401, "unauthorized", "log in first");
    const session = findSession(options.db, sessionId);
    if (!session) return problem(c, 401, "unauthorized", "log in first");
    c.set("user", session.user);
    c.set("sessionId", session.sessionId);
    annotateLog({ "user.id": session.user.id, "session.id": session.sessionId });
    await next();
  });

  app.post("/api/logout", (c) => {
    const sessionId = c.get("sessionId");
    if (sessionId) deleteSession(options.db, sessionId);
    c.header("set-cookie", clearSessionCookie());
    log({ severity: "INFO", body: "logged out", event: "auth.logout" });
    return c.json({ ok: true });
  });

  app.get("/api/me", (c) => {
    const user = c.get("user");
    if (!user) return problem(c, 401, "unauthorized", "log in first");
    return c.json({ ok: true, user });
  });

  app.post("/api/drafts", async (c) => {
    const actor = actorFrom(c);
    if (!actor) return problem(c, 401, "unauthorized", "log in first");
    const body = await readJsonBody(c);
    if (!body.ok) return problem(c, 400, "bad_request", body.message);
    const compose = parseComposeInput(body.value);
    if (!compose.ok) return problem(c, 400, "bad_request", compose.message);
    const draft = createDraft(options.db, {
      id: newId("drf"),
      userId: actor.user.id,
      sessionId: actor.sessionId,
      notes: compose.value.notes,
      snippets: compose.value.snippets,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try {
      response = await fetchImpl(endpoint(options.agentUrl, "/v1/messages"), {
        method: "POST",
        headers: agentHeaders(options.internalToken),
        body: JSON.stringify({
          userId: actor.user.id,
          sessionId: actor.sessionId,
          draftId: draft.id,
          notes: draft.notes,
          snippets: draft.snippets,
        }),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      markDraftFailed(options.db, draft.id);
      return problem(c, 502, "agent_unavailable", "the poster agent is not answering");
    }
    if (!response.ok || !response.body) {
      clearTimeout(timer);
      markDraftFailed(options.db, draft.id);
      return problem(c, 502, "agent_unavailable", "the poster agent is not answering");
    }
    const agentBody = response.body;
    c.header("cache-control", "no-cache, no-transform");
    c.header("x-accel-buffering", "no");
    return streamSSE(c, async (stream) => {
      let sawPoster = false;
      try {
        await stream.writeSSE({ event: "draft", data: JSON.stringify({ draftId: draft.id }) });
        const reader = agentBody.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const parsed = parseSseChunk(buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) {
            if (event.event === "delta") {
              const text = jsonStringField(event.data, "text");
              if (text === null) continue;
              await safeWrite(stream, "delta", JSON.stringify({ text }));
            } else if (event.event === "poster" && !sawPoster) {
              const greeting = jsonStringField(event.data, "greeting");
              if (!greeting) continue;
              sawPoster = true;
              markDraftReady(options.db, draft.id, greeting);
              await safeWrite(stream, "poster", JSON.stringify({ draftId: draft.id, greeting }));
            } else if (event.event === "done") {
              await safeWrite(stream, "done", "{}");
            }
          }
        }
        if (!sawPoster) {
          markDraftFailed(options.db, draft.id);
          await safeWrite(stream, "error", JSON.stringify({ message: "the poster did not finish" }));
        } else {
          log({
            severity: "INFO",
            body: "greeting ready",
            event: "poster.stream.ready",
            attributes: { "draft.id": draft.id },
          });
        }
      } catch {
        if (!sawPoster) markDraftFailed(options.db, draft.id);
        await safeWrite(stream, "error", JSON.stringify({ message: "the poster did not finish" }));
      } finally {
        clearTimeout(timer);
      }
    });
  });

  app.get("/api/drafts/:id", (c) => {
    const actor = actorFrom(c);
    if (!actor) return problem(c, 401, "unauthorized", "log in first");
    const id = c.req.param("id");
    if (!ID.test(id)) return problem(c, 404, "not_found", "that draft is not here");
    const draft = findDraft(options.db, id);
    if (!draft || draft.userId !== actor.user.id) return problem(c, 404, "not_found", "that draft is not here");
    return c.json({ ok: true, draft: draftDto(draft) });
  });

  app.post("/api/drafts/:id/approve", async (c) => {
    const actor = actorFrom(c);
    if (!actor) return problem(c, 401, "unauthorized", "log in first");
    const id = c.req.param("id");
    if (!ID.test(id)) return problem(c, 404, "not_found", "that draft is not here");
    const draft = findDraft(options.db, id);
    if (!draft || draft.userId !== actor.user.id) return problem(c, 404, "not_found", "that draft is not here");
    if (draft.status === "approved") return problem(c, 409, "already", "that poster is already on the wall");
    if (draft.status !== "ready") return problem(c, 409, "not_ready", "the poster is not ready to approve");
    const placed = await requestPlacement({
      agentUrl: options.agentUrl,
      internalToken: options.internalToken,
      fetchImpl,
      input: {
        userId: actor.user.id,
        sessionId: actor.sessionId,
        draftId: draft.id,
        notes: draft.notes,
        snippets: draft.snippets,
        greeting: draft.greeting,
      },
    });
    if (!placed.ok) return problem(c, 502, "agent_unavailable", placed.message);
    const published = publishPoster(options.db, {
      userId: actor.user.id,
      draftId: draft.id,
      placement: placed.placement,
    });
    if (!published.ok) {
      if (published.error === "already") return problem(c, 409, "already", "that poster is already on the wall");
      if (published.error === "not_ready") return problem(c, 409, "not_ready", "the poster is not ready to approve");
      return problem(c, 404, "not_found", "that draft is not here");
    }
    addCount("demo_wall.posters.published");
    log({
      severity: "INFO",
      body: "poster published",
      event: "poster.published",
      attributes: { "draft.id": draft.id, category: placed.placement.category, group: placed.placement.group },
    });
    return c.json({
      ok: true,
      placement: placed.placement,
      poster: posterDto(published.poster, actor.user.id),
    });
  });

  app.get("/api/boards", (c) => {
    if (!actorFrom(c)) return problem(c, 401, "unauthorized", "log in first");
    return c.json({ ok: true, boards: listBoards(options.db) });
  });

  app.get("/api/boards/:category", (c) => {
    const actor = actorFrom(c);
    if (!actor) return problem(c, 401, "unauthorized", "log in first");
    const category = c.req.param("category");
    if (!CATEGORY.test(category)) return problem(c, 404, "not_found", "that board is not here");
    const posters = listPosters(options.db, category);
    const first = posters[0];
    if (!first) return problem(c, 404, "not_found", "that board is not here");
    return c.json({
      ok: true,
      category: first.category,
      categoryLabel: first.categoryLabel,
      groups: groupPosters(posters, actor.user.id),
    });
  });

  app.get("/", (c) => c.html(files.index, 200, { "cache-control": "no-store" }));
  app.get("/styles.css", (c) => c.body(files.css, 200, { "content-type": "text/css; charset=utf-8" }));
  app.get("/favicon.svg", (c) => c.body(files.icon, 200, { "content-type": "image/svg+xml" }));
  app.get("/assets/main.js", (c) =>
    c.body(files.script, 200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    }),
  );
  app.notFound((c) => {
    if (c.req.path.startsWith("/api")) {
      return c.json({ ok: false, error: "not_found", message: "that route is not here" }, 404);
    }
    return c.html(files.index);
  });
  return app;
}

function actorFrom(c: Context<WallEnv>): { user: PublicUser; sessionId: string } | null {
  const user = c.get("user");
  const sessionId = c.get("sessionId");
  if (!user || !sessionId) return null;
  return { user, sessionId };
}

function publicUser(user: { id: string; displayName: string }): PublicUser {
  return { id: user.id, displayName: user.displayName };
}

function draftDto(draft: Draft): {
  id: string;
  notes: string;
  snippets: string[];
  greeting: string;
  status: Draft["status"];
  createdAt: string;
} {
  return {
    id: draft.id,
    notes: draft.notes,
    snippets: draft.snippets,
    greeting: draft.greeting,
    status: draft.status,
    createdAt: draft.createdAt,
  };
}

function posterDto(poster: Poster, viewerId: string): {
  id: string;
  displayName: string;
  greeting: string;
  category: string;
  categoryLabel: string;
  group: string;
  createdAt: string;
  mine: boolean;
} {
  return {
    id: poster.id,
    displayName: poster.displayName,
    greeting: poster.greeting,
    category: poster.category,
    categoryLabel: poster.categoryLabel,
    group: poster.group,
    createdAt: poster.createdAt,
    mine: poster.userId === viewerId,
  };
}

function groupPosters(posters: readonly Poster[], viewerId: string): { name: string; posters: ReturnType<typeof posterDto>[] }[] {
  const buckets = new Map<string, ReturnType<typeof posterDto>[]>();
  for (const poster of posters) {
    const list = buckets.get(poster.group) ?? [];
    list.push(posterDto(poster, viewerId));
    buckets.set(poster.group, list);
  }
  const names = [
    ...GROUP_ORDER.filter((name) => buckets.has(name)),
    ...[...buckets.keys()].filter((name) => !GROUP_ORDER.includes(name)),
  ];
  return names.map((name) => ({ name, posters: buckets.get(name) ?? [] }));
}

async function readCredentials(
  c: Context,
): Promise<{ ok: true; displayName: string; password: string } | { ok: false; message: string }> {
  const body = await readJsonBody(c);
  if (!body.ok) return body;
  const value = body.value;
  if (typeof value !== "object" || value === null) return { ok: false, message: "send a name and a password" };
  if (!("displayName" in value) || !("password" in value)) {
    return { ok: false, message: "send a name and a password" };
  }
  if (typeof value.displayName !== "string" || typeof value.password !== "string") {
    return { ok: false, message: "send a name and a password" };
  }
  const displayName = value.displayName.trim();
  if (!validName(displayName)) return { ok: false, message: "use 2 to 24 letters or numbers" };
  const passwordError = passwordProblem(value.password);
  if (passwordError) return { ok: false, message: passwordError };
  return { ok: true, displayName, password: value.password };
}

async function readJsonBody(c: Context): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.includes("application/json")) return { ok: false, message: "send json" };
  const text = await c.req.text();
  if (text.length > 32_000) return { ok: false, message: "that message is too big" };
  const parsed = parseJson(text);
  if (!parsed.ok) return { ok: false, message: "that json did not parse" };
  return parsed;
}

function problem(c: Context, status: 400 | 401 | 404 | 409 | 502, error: string, message: string): Response {
  return c.json({ ok: false, error, message }, status);
}

async function safeWrite(
  stream: { writeSSE: (message: { event: string; data: string }) => Promise<void> },
  event: string,
  data: string,
): Promise<void> {
  try {
    await stream.writeSSE({ event, data });
  } catch {
    // The browser left. The draft is still saved.
  }
}

function loadPublic(): PublicFiles {
  const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
  const scriptPath = join(publicDir, "assets", "main.js");
  try {
    return {
      index: readFileSync(join(publicDir, "index.html"), "utf8"),
      css: readFileSync(join(publicDir, "styles.css"), "utf8"),
      script: readFileSync(scriptPath, "utf8"),
      icon: readFileSync(join(publicDir, "favicon.svg"), "utf8"),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "missing client build";
    throw new Error(`missing client build (${message}). run npm run build`);
  }
}
