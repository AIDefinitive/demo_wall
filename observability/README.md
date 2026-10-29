# Observability

Both processes write one JSON object per operational log line. The keys in `fields.json` are the shared fields. Extra detail sits under `attributes` and never includes passwords, cookies, or tokens.

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to export traces, metrics, and logs over OTLP/HTTP. Leave it empty to keep telemetry on stdout. This app does not pick a collector or a cloud.
