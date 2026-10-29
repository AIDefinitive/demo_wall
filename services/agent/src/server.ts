import { join } from "node:path";

import { serve } from "@hono/node-server";
import {
  initObservability,
  loadEnvFile,
  log,
  readNonNegative,
  readPort,
  readString,
  shutdownObservability,
} from "@demo-wall/observability";

import { createAgentApp } from "./app.js";

loadEnvFile(join(process.cwd(), ".env"));
initObservability({ serviceName: "poster-agent" });

const port = readPort("PORT", readPort("AGENT_PORT", 4001));
const app = createAgentApp({
  delayMs: readNonNegative("STREAM_DELAY_MS", 28, 80),
  internalToken: readString("INTERNAL_TOKEN", ""),
});

const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  log({
    severity: "INFO",
    body: "poster agent listening",
    event: "server.listen",
    attributes: { port: info.port },
  });
});

server.on("error", (error: unknown) => {
  const message = error instanceof Error ? error.message : "listen failed";
  log({ severity: "ERROR", body: message, event: "server.error" });
  process.exit(1);
});

let stopping = false;
function stop(): void {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    void Promise.race([
      shutdownObservability(),
      new Promise((resolve) => {
        setTimeout(resolve, 2000);
      }),
    ]).finally(() => process.exit(0));
  });
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
