import { categorize, composeGreeting, parseCategorizeInput, parseMessageInput, streamPieces } from "@demo-wall/agent-core";
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

import { bearerOk } from "./token.js";

export type AgentOptions = {
  delayMs: number;
  internalToken: string;
};

export function createAgentApp(options: AgentOptions): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    log({
      severity: "ERROR",
      body: error.message,
      event: "http.error",
    });
    return c.json({ ok: false, error: "internal", message: "the poster agent broke" }, 500);
  });

  app.use("*", async (c, next) => {
    const started = Date.now();
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

  app.get("/health", (c) => c.json({ ok: true, service: "poster-agent" }));

  app.post("/v1/messages", async (c) => {
    if (!bearerOk(c.req.header("authorization"), options.internalToken)) {
      return problem(c, 401, "unauthorized", "the poster agent refused this caller");
    }
    const body = await readBody(c);
    if (!body.ok) return problem(c, 400, "bad_request", body.message);
    const message = parseMessageInput(body.value);
    if (!message.ok) return problem(c, 400, "bad_request", message.message);
    annotateLog({
      "user.id": message.value.userId,
      "session.id": message.value.sessionId,
      "draft.id": message.value.draftId,
    });
    const greeting = composeGreeting(message.value.notes, message.value.snippets);
    const pieces = streamPieces(greeting);
    addCount("demo_wall.agent.messages");
    return streamSSE(c, async (stream) => {
      for (const piece of pieces) {
        await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: piece }) });
        await wait(options.delayMs);
      }
      await stream.writeSSE({ event: "poster", data: JSON.stringify({ greeting }) });
      await stream.writeSSE({ event: "done", data: "{}" });
      log({
        severity: "INFO",
        body: "greeting streamed",
        event: "agent.message.completed",
        attributes: { "draft.id": message.value.draftId },
      });
    });
  });

  app.post("/v1/categorize", async (c) => {
    if (!bearerOk(c.req.header("authorization"), options.internalToken)) {
      return problem(c, 401, "unauthorized", "the poster agent refused this caller");
    }
    const body = await readBody(c);
    if (!body.ok) return problem(c, 400, "bad_request", body.message);
    const input = parseCategorizeInput(body.value);
    if (!input.ok) return problem(c, 400, "bad_request", input.message);
    annotateLog({
      "user.id": input.value.userId,
      "session.id": input.value.sessionId,
      "draft.id": input.value.draftId,
    });
    const placement = categorize(input.value);
    addCount("demo_wall.agent.categorized");
    log({
      severity: "INFO",
      body: "poster categorized",
      event: "agent.categorized",
      attributes: { category: placement.category, group: placement.group },
    });
    return c.json({ ok: true, placement });
  });

  app.notFound((c) => c.json({ ok: false, error: "not_found", message: "that route is not here" }, 404));
  return app;
}

async function readBody(c: Context): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.includes("application/json")) return { ok: false, message: "send json" };
  const text = await c.req.text();
  if (text.length > 32_000) return { ok: false, message: "that message is too big" };
  const parsed = parseJson(text);
  if (!parsed.ok) return { ok: false, message: "that json did not parse" };
  return parsed;
}

function problem(c: Context, status: 400 | 401 | 404, error: string, message: string): Response {
  return c.json({ ok: false, error, message }, status);
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
