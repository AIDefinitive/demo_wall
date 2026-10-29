import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
loadEnv(join(root, ".env"));

const wallPort = process.env.WALL_PORT?.trim() || "4000";
const agentPort = process.env.AGENT_PORT?.trim() || "4001";
const agentUrl = process.env.AGENT_URL?.trim() || `http://127.0.0.1:${agentPort}`;

const children = [];
let stopping = false;

function start(args, env) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (stopping) return;
    shutdown(signal ? 0 : code ?? 1);
  });
}

function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.error(`poster agent  http://127.0.0.1:${agentPort}`);
console.error(`hey wall      http://127.0.0.1:${wallPort}`);

start(["services/agent/dist/server.js"], {
  PORT: agentPort,
  OTEL_SERVICE_NAME: "poster-agent",
});
start(["--experimental-sqlite", "services/wall/dist/server.js"], {
  PORT: wallPort,
  AGENT_URL: agentUrl,
  OTEL_SERVICE_NAME: "wall",
});

function loadEnv(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
