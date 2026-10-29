import assert from "node:assert/strict";
import { test } from "node:test";

import { serve } from "@hono/node-server";

import { createAgentApp } from "@demo-wall/agent/app";
import { createWallApp } from "./app.js";
import { openDatabase } from "./db.js";
import { seedIfEmpty } from "./seed.js";

test("health, publish, and browsing other people", async () => {
  const agent = await listen(createAgentApp({ delayMs: 0, internalToken: "" }));
  const db = openDatabase(":memory:");
  try {
    const wall = createWallApp({ db, agentUrl: agent.url, internalToken: "" });

    const health = await wall.request("/health");
    assert.equal(health.status, 200);
    const healthBody = await readJson(health);
    assert.equal(field(healthBody, "service"), "wall");

    const hidden = await wall.request("/api/boards");
    assert.equal(hidden.status, 401);

    const page = await wall.request("/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /HEY WALL/);

    const casey = await signup(wall, "casey", "local-demo-1");
    const notes = "I am exhausted and drained today. SECRET_SECOND_SENTENCE stays off the board.";
    const streamed = await wall.request("/api/drafts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: casey.cookie },
      body: JSON.stringify({ notes, snippets: ["still here"] }),
    });
    assert.equal(streamed.status, 200);
    const sse = await streamed.text();
    assert.match(sse, /still here/);
    assert.equal(sse.includes("SECRET_SECOND_SENTENCE"), false);
    const draftId = draftIdFrom(sse);
    const draft = await wall.request(`/api/drafts/${draftId}`, { headers: { cookie: casey.cookie } });
    const draftBody = await readJson(draft);
    const draftRecord = record(field(draftBody, "draft"));
    assert.equal(field(draftRecord, "status"), "ready");
    assert.match(String(field(draftRecord, "notes")), /SECRET_SECOND_SENTENCE/);

    const approved = await wall.request(`/api/drafts/${draftId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: casey.cookie },
      body: JSON.stringify({ category: "glow-ups" }),
    });
    assert.equal(approved.status, 200);
    const approvedBody = await readJson(approved);
    const placement = record(field(approvedBody, "placement"));
    assert.equal(field(placement, "category"), "low-battery");
    assert.equal(field(placement, "group"), "keep it close");

    const again = await wall.request(`/api/drafts/${draftId}/approve`, {
      method: "POST",
      headers: { cookie: casey.cookie },
    });
    assert.equal(again.status, 409);

    const riley = await signup(wall, "riley", "local-demo-2");
    const stolen = await wall.request(`/api/drafts/${draftId}`, { headers: { cookie: riley.cookie } });
    assert.equal(stolen.status, 404);
    const board = await wall.request("/api/boards/low-battery", { headers: { cookie: riley.cookie } });
    assert.equal(board.status, 200);
    const boardText = JSON.stringify(await readJson(board));
    assert.match(boardText, /casey/);
    assert.match(boardText, /still here/);
    assert.equal(boardText.includes("SECRET_SECOND_SENTENCE"), false);
    assert.equal(boardText.includes("\"notes\""), false);

    const badLogin = await wall.request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "casey", password: "correct-horse-stencil" }),
    });
    assert.equal(badLogin.status, 401);
    assert.equal((await badLogin.text()).includes("correct-horse-stencil"), false);
  } finally {
    db.close();
    await agent.close();
  }
});

test("house posters are readable by a new account", async () => {
  const db = openDatabase(":memory:");
  try {
    await seedIfEmpty(db);
    await seedIfEmpty(db);
    const wall = createWallApp({ db, agentUrl: "http://127.0.0.1:9", internalToken: "" });
    const visitor = await signup(wall, "visitor", "local-demo-3");
    const boards = await wall.request("/api/boards", { headers: { cookie: visitor.cookie } });
    const listed = await readJson(boards);
    const names = JSON.stringify(field(listed, "boards"));
    assert.match(names, /soft-hours/);
    assert.match(names, /glow-ups/);
    assert.match(names, /for-the-groupchat/);
    const soft = await wall.request("/api/boards/soft-hours", { headers: { cookie: visitor.cookie } });
    const softText = JSON.stringify(await readJson(soft));
    assert.match(softText, /nova/);
    assert.match(softText, /keep it close/);
  } finally {
    db.close();
  }
});

test("a dead agent does not publish", async () => {
  const db = openDatabase(":memory:");
  try {
    const wall = createWallApp({ db, agentUrl: "http://127.0.0.1:9", internalToken: "" });
    const user = await signup(wall, "sam", "local-demo-4");
    const response = await wall.request("/api/drafts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: user.cookie },
      body: JSON.stringify({ notes: "quiet night after a long week", snippets: [] }),
    });
    assert.equal(response.status, 502);
    const boards = await wall.request("/api/boards", { headers: { cookie: user.cookie } });
    const body = await readJson(boards);
    assert.deepEqual(field(body, "boards"), []);
  } finally {
    db.close();
  }
});

async function signup(
  wall: ReturnType<typeof createWallApp>,
  displayName: string,
  password: string,
): Promise<{ cookie: string }> {
  const response = await wall.request("/api/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName, password }),
  });
  assert.equal(response.status, 200);
  const header = response.headers.get("set-cookie");
  assert.ok(header);
  const cookie = header.split(";")[0];
  assert.ok(cookie);
  return { cookie };
}

function draftIdFrom(text: string): string {
  const match = /event: draft\ndata: (.*)/.exec(text);
  const raw = match?.[1];
  assert.ok(raw);
  const parsed: unknown = JSON.parse(raw) as unknown;
  const recordValue = record(parsed);
  const draftId = field(recordValue, "draftId");
  assert.equal(typeof draftId, "string");
  if (typeof draftId !== "string") throw new Error("missing draft");
  return draftId;
}

async function readJson(response: Response): Promise<unknown> {
  return JSON.parse(await response.text()) as unknown;
}

function record(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.ok(value !== null);
  if (typeof value !== "object" || value === null) throw new Error("expected object");
  const row: Record<string, unknown> = {};
  for (const [key, cell] of Object.entries(value)) row[key] = cell;
  return row;
}

function field(value: unknown, key: string): unknown {
  return record(value)[key];
}

function listen(app: ReturnType<typeof createAgentApp>): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      resolve({
        url: `http://127.0.0.1:${info.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
    server.on("error", reject);
  });
}
