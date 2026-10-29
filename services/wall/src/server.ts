import { join, resolve } from "node:path";

import { serve } from "@hono/node-server";
import {
  initObservability,
  loadEnvFile,
  log,
  readPort,
  readString,
  shutdownObservability,
} from "@demo-wall/observability";

import { createWallApp } from "./app.js";
import { failLeftoverDrafts, openDatabase } from "./db.js";
import { seedIfEmpty } from "./seed.js";

loadEnvFile(join(process.cwd(), ".env"));
initObservability({ serviceName: "wall" });

const port = readPort("PORT", readPort("WALL_PORT", 4000));
const db = openDatabase(resolve(readString("DATA_DIR", "data"), "wall.sqlite"));
failLeftoverDrafts(db);
await seedIfEmpty(db);

const app = createWallApp({
  db,
  agentUrl: readString("AGENT_URL", "http://127.0.0.1:4001"),
  internalToken: readString("INTERNAL_TOKEN", ""),
});

const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  log({
    severity: "INFO",
    body: "wall listening",
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
    db.close();
    void Promise.race([
      shutdownObservability(),
      new Promise((resolveTimeout) => {
        setTimeout(resolveTimeout, 2000);
      }),
    ]).finally(() => process.exit(0));
  });
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
