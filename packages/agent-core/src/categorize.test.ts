import assert from "node:assert/strict";
import { test } from "node:test";

import { categorize, parsePlacement } from "./categorize.js";

test("tired language lands in soft hours", () => {
  const placement = categorize({
    notes: "quiet night, soft and tired",
    snippets: [],
    greeting: "rest",
  });
  assert.deepEqual(placement, {
    category: "soft-hours",
    categoryLabel: "soft hours",
    group: "keep it close",
  });
});

test("drained language lands in low battery", () => {
  const placement = categorize({
    notes: "I am exhausted and drained",
    snippets: [],
    greeting: "empty",
  });
  assert.equal(placement.category, "low-battery");
  assert.equal(placement.group, "keep it close");
});

test("group words beat a single glow word", () => {
  const placement = categorize({
    notes: "we finally told the group chat",
    snippets: [],
    greeting: "tell them",
  });
  assert.equal(placement.category, "for-the-groupchat");
  assert.equal(placement.group, "pass it on");
});

test("sleep does not count the word we inside went", () => {
  const placement = categorize({
    notes: "went to sleep",
    snippets: [],
    greeting: "night",
  });
  assert.equal(placement.category, "soft-hours");
});

test("a note with no signal stays unfiled", () => {
  const placement = categorize({
    notes: "hello there friend",
    snippets: [],
    greeting: "hello",
  });
  assert.equal(placement.category, "unfiled");
});

test("placement parser rejects a mismatched group", () => {
  assert.equal(
    parsePlacement({ category: "soft-hours", categoryLabel: "soft hours", group: "say it loud" }),
    null,
  );
  assert.deepEqual(parsePlacement({ category: "soft-hours", categoryLabel: "soft hours", group: "keep it close" }), {
    category: "soft-hours",
    categoryLabel: "soft hours",
    group: "keep it close",
  });
});
