import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const pattern = /:\s*any\b|\bas\s+any\b|<any\b/;
const skip = new Set(["node_modules", "dist", "data", "public", "assets"]);
const roots = ["packages", "services", "scripts"];
const failures = [];

function walk(directory) {
  for (const name of readdirSync(directory)) {
    if (skip.has(name)) continue;
    const path = join(directory, name);
    const info = statSync(path);
    if (info.isDirectory()) {
      walk(path);
      continue;
    }
    if (!name.endsWith(".ts") && !name.endsWith(".mjs")) continue;
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (pattern.test(lines[index] ?? "")) {
        failures.push(`${path}:${index + 1}`);
      }
    }
  }
}

for (const root of roots) {
  walk(root);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
