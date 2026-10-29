import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCategorizeInput, parseComposeInput, parseMessageInput } from "./parse.js";

test("compose input trims and drops empty snippets", () => {
  const parsed = parseComposeInput({
    notes: "  quiet night after a long week  ",
    snippets: [" still here ", "", "still here"],
  });
  assert.deepEqual(parsed, {
    ok: true,
    value: { notes: "quiet night after a long week", snippets: ["still here"] },
  });
});

test("short notes are rejected", () => {
  const parsed = parseComposeInput({ notes: "hey", snippets: [] });
  assert.equal(parsed.ok, false);
});

test("message input requires ids", () => {
  const parsed = parseMessageInput({
    notes: "quiet night after a long week",
    snippets: [],
    userId: "usr_1",
    sessionId: "ses_1",
  });
  assert.equal(parsed.ok, false);
});

test("categorize input requires a greeting", () => {
  const parsed = parseCategorizeInput({
    userId: "usr_1",
    sessionId: "ses_1",
    draftId: "drf_1",
    notes: "quiet night after a long week",
    snippets: ["still here"],
    greeting: "pin this",
  });
  assert.equal(parsed.ok, true);
});
