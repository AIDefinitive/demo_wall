import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { SHARED_JSON_FIELDS } from "./fields.js";
import { parseJson } from "./json.js";
import { formatLog } from "./logger.js";
import { initObservability } from "./otel.js";

test("shared field list matches observability/fields.json", () => {
  const jsonPath = fileURLToPath(new URL("../../../observability/fields.json", import.meta.url));
  const parsed = parseJson(readFileSync(jsonPath, "utf8"));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const value = parsed.value;
  assert.equal(typeof value, "object");
  assert.ok(value !== null);
  if (typeof value !== "object" || value === null || !("fields" in value)) {
    assert.fail("fields.json is missing fields");
  }
  const fields = value.fields;
  assert.ok(Array.isArray(fields));
  assert.deepEqual(fields, [...SHARED_JSON_FIELDS]);
});

test("log lines include every shared field", () => {
  initObservability({ serviceName: "wall" });
  const line = formatLog({
    severity: "INFO",
    body: "poster published",
    event: "poster.published",
    attributes: { "user.id": "usr_1", "session.id": "ses_1", password: "nope" },
  });
  const parsed = parseJson(line);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const value = parsed.value;
  assert.equal(typeof value, "object");
  assert.ok(value !== null);
  if (typeof value !== "object" || value === null) return;
  for (const field of SHARED_JSON_FIELDS) {
    assert.equal(Object.hasOwn(value, field), true, field);
  }
  assert.equal(Reflect.get(value, "service.name"), "wall");
  assert.equal(Reflect.get(value, "event"), "poster.published");
  assert.equal(line.includes("nope"), false);
  const attributes = Reflect.get(value, "attributes");
  assert.equal(typeof attributes, "object");
  assert.ok(attributes !== null);
  if (typeof attributes !== "object" || attributes === null) return;
  assert.equal(Reflect.get(attributes, "user.id"), "usr_1");
  assert.equal(Object.hasOwn(attributes, "password"), false);
});
