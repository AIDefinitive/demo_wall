import assert from "node:assert/strict";
import { test } from "node:test";

import { jsonStringField, parseSseChunk } from "./sse.js";

test("sse frames split from a partial buffer", () => {
  const first = parseSseChunk("event: delta\ndata: {\"text\":\"hey\"}\n\nevent: del");
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0]?.event, "delta");
  assert.equal(jsonStringField(first.events[0]?.data ?? "", "text"), "hey");
  assert.equal(first.rest, "event: del");
  const second = parseSseChunk(`${first.rest}ta\ndata: {\"text\":\"!\"}\n\n`);
  assert.equal(second.events[0]?.event, "delta");
  assert.equal(jsonStringField(second.events[0]?.data ?? "", "text"), "!");
  assert.equal(second.rest, "");
});
