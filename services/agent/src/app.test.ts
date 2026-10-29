import assert from "node:assert/strict";
import { test } from "node:test";

import { createAgentApp } from "./app.js";

const message = {
  userId: "usr_test",
  sessionId: "ses_test",
  draftId: "drf_test",
  notes: "quiet night after a long week",
  snippets: ["still here"],
};

test("health answers without a token", async () => {
  const app = createAgentApp({ delayMs: 0, internalToken: "test-token" });
  const response = await app.request("/health");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "poster-agent");
});

test("messages stream a poster that keeps the snippet", async () => {
  const app = createAgentApp({ delayMs: 0, internalToken: "" });
  const response = await app.request("/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  const text = await response.text();
  assert.match(text, /event: delta/);
  assert.match(text, /event: poster/);
  assert.match(text, /event: done/);
  assert.match(text, /still here/);
});

test("a configured token is required", async () => {
  const app = createAgentApp({ delayMs: 0, internalToken: "test-token" });
  const denied = await app.request("/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  assert.equal(denied.status, 401);
  const allowed = await app.request("/v1/categorize", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-token",
    },
    body: JSON.stringify({
      ...message,
      notes: "I am exhausted and drained",
      greeting: "empty cup",
    }),
  });
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.equal(body.placement.category, "low-battery");
  assert.equal(body.placement.group, "keep it close");
});

test("bad messages are refused", async () => {
  const app = createAgentApp({ delayMs: 0, internalToken: "" });
  const response = await app.request("/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notes: "too short" }),
  });
  assert.equal(response.status, 400);
});
