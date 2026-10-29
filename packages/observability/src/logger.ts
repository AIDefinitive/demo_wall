import { logs, SeverityNumber, type Logger } from "@opentelemetry/api-logs";

import { activeTraceIds, currentLogContext, safeAttributes } from "./context.js";
import type { LogAttributes, Severity } from "./fields.js";
import { serviceState } from "./state.js";

export type LogInput = {
  severity: Severity;
  body: string;
  event: string;
  attributes?: LogAttributes;
};

const severityNumber: Record<Severity, SeverityNumber> = {
  INFO: SeverityNumber.INFO,
  WARN: SeverityNumber.WARN,
  ERROR: SeverityNumber.ERROR,
};

let otelLogger: Logger | null = null;

export function formatLog(input: LogInput): string {
  const active = activeTraceIds();
  const stored = currentLogContext();
  const attributes = safeAttributes({
    ...(stored?.attributes ?? {}),
    ...(input.attributes ?? {}),
  });
  const record: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    severity: input.severity,
    body: input.body,
    event: input.event,
    "service.name": serviceState.serviceName,
    "service.version": serviceState.serviceVersion,
    "service.namespace": serviceState.serviceNamespace,
    "deployment.environment": serviceState.environment,
    trace_id: active?.traceId ?? stored?.traceId ?? "",
    span_id: active?.spanId ?? stored?.spanId ?? "",
  };
  if (Object.keys(attributes).length > 0) record.attributes = attributes;
  return JSON.stringify(record);
}

export function log(input: LogInput): void {
  const line = formatLog(input);
  console.log(line);
  emitOtel(input);
}

function emitOtel(input: LogInput): void {
  try {
    otelLogger ??= logs.getLogger("demo-wall");
    const stored = currentLogContext();
    const attributes = safeAttributes({
      event: input.event,
      ...(stored?.attributes ?? {}),
      ...(input.attributes ?? {}),
    });
    otelLogger.emit({
      severityNumber: severityNumber[input.severity],
      severityText: input.severity,
      body: input.body,
      attributes,
    });
  } catch {
    otelLogger = null;
  }
}
