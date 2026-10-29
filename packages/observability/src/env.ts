import { existsSync, readFileSync } from "node:fs";

export function loadEnvFile(file: string): void {
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

export function readString(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim();
}

export function readPort(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid ${name}`);
  }
  return port;
}

export function readNonNegative(name: string, fallback: number, cap: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid ${name}`);
  }
  return Math.min(parsed, cap);
}
