import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

import { trace, isSpanContextValid } from "@opentelemetry/api";

import type { LogAttributes } from "./fields.js";

export type LogContext = {
  traceId: string;
  spanId: string;
  attributes: LogAttributes;
};

const storage = new AsyncLocalStorage<LogContext>();

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function activeTraceIds(): { traceId: string; spanId: string } | null {
  const span = trace.getActiveSpan();
  if (!span) return null;
  const spanContext = span.spanContext();
  if (!isSpanContextValid(spanContext)) return null;
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function annotateLog(attributes: LogAttributes): void {
  const current = storage.getStore();
  if (!current) return;
  Object.assign(current.attributes, safeAttributes(attributes));
}

export function currentLogContext(): LogContext | undefined {
  return storage.getStore();
}

const blockedKey = /password|authorization|token|secret|cookie/i;

export function safeAttributes(input: LogAttributes): LogAttributes {
  const safe: LogAttributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (blockedKey.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}
