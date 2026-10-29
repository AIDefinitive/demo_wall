export const SHARED_JSON_FIELDS = [
  "timestamp",
  "severity",
  "body",
  "event",
  "service.name",
  "service.version",
  "service.namespace",
  "deployment.environment",
  "trace_id",
  "span_id",
] as const;

export type SharedField = (typeof SHARED_JSON_FIELDS)[number];

export type Severity = "INFO" | "WARN" | "ERROR";

export type LogValue = string | number | boolean;

export type LogAttributes = Record<string, LogValue>;
