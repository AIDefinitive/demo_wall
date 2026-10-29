import assert from "node:assert/strict";
import { test } from "node:test";

import { composeGreeting, firstSentence, streamPieces } from "./compose.js";

test("greeting keeps the first sentence and the snippet", () => {
  const notes = "quiet night after a long week. SECRET_SECOND_SENTENCE stays off the poster.";
  const greeting = composeGreeting(notes, ["still here"]);
  assert.match(greeting, /quiet night after a long week\./);
  assert.match(greeting, /still here/);
  assert.equal(greeting.includes("SECRET_SECOND_SENTENCE"), false);
  assert.equal(composeGreeting(notes, ["still here"]), greeting);
});

test("first sentence stops at the first stop", () => {
  assert.equal(firstSentence("hello there friend. the rest is private."), "hello there friend.");
});

test("stream pieces rejoin into the greeting", () => {
  const greeting = composeGreeting("made it through a quiet week.", ["still here"]);
  assert.equal(streamPieces(greeting).join(""), greeting);
});
