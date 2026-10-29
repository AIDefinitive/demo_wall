import { metrics, trace, SpanStatusCode, type Counter, type Span } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";

import { readString } from "./env.js";
import { serviceState } from "./state.js";

const counters = new Map<string, Counter>();
let sdkStarted = false;
let shutdownSdk: () => Promise<void> = async () => {};

export type InitOptions = {
  serviceName: string;
};

export function initObservability(options: InitOptions): void {
  serviceState.serviceName = readString("OTEL_SERVICE_NAME", options.serviceName);
  serviceState.serviceVersion = readString("SERVICE_VERSION", "0.1.0");
  serviceState.serviceNamespace = "demo-wall";
  serviceState.environment = readString("DEPLOYMENT_ENVIRONMENT", "local");
  if (sdkStarted) return;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ?? "";
  if (endpoint.length === 0) return;
  sdkStarted = true;
  const resource = defaultResource().merge(
    resourceFromAttributes({
      "service.name": serviceState.serviceName,
      "service.version": serviceState.serviceVersion,
      "service.namespace": serviceState.serviceNamespace,
      "deployment.environment": serviceState.environment,
      "deployment.environment.name": serviceState.environment,
    }),
  );
  const sdk = new NodeSDK({
    resource,
    serviceName: serviceState.serviceName,
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
      }),
    ],
    logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
  });
  sdk.start();
  shutdownSdk = () => sdk.shutdown();
}

export async function shutdownObservability(): Promise<void> {
  await shutdownSdk();
}

export async function withSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  const tracer = trace.getTracer("demo-wall", serviceState.serviceVersion);
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function addCount(name: string): void {
  let counter = counters.get(name);
  if (!counter) {
    counter = metrics.getMeter("demo-wall", serviceState.serviceVersion).createCounter(name);
    counters.set(name, counter);
  }
  counter.add(1);
}
