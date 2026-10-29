import { parseJson } from "@demo-wall/observability";

export type SseEvent = {
  event: string;
  data: string;
};

export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: SseEvent[] = [];
  for (const part of parts) {
    if (part.trim().length === 0) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length > 0) events.push({ event, data: dataLines.join("\n") });
  }
  return { events, rest };
}

export function jsonStringField(data: string, key: string): string | null {
  const parsed = parseJson(data);
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) return null;
  if (!(key in parsed.value)) return null;
  const value = parsed.value[key];
  return typeof value === "string" ? value : null;
}
