import { parsePlacement, type CategorizeInput, type Placement } from "@demo-wall/agent-core";
import { parseJson } from "@demo-wall/observability";

export async function requestPlacement(options: {
  agentUrl: string;
  internalToken: string;
  fetchImpl: typeof fetch;
  input: CategorizeInput;
}): Promise<{ ok: true; placement: Placement } | { ok: false; message: string }> {
  try {
    const response = await options.fetchImpl(endpoint(options.agentUrl, "/v1/categorize"), {
      method: "POST",
      headers: agentHeaders(options.internalToken),
      body: JSON.stringify(options.input),
      signal: AbortSignal.timeout(12_000),
    });
    const parsed = parseJson(await response.text());
    if (!response.ok || !parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
      return { ok: false, message: "the poster agent could not place that" };
    }
    if (!("placement" in parsed.value)) return { ok: false, message: "the poster agent could not place that" };
    const placement = parsePlacement(parsed.value.placement);
    if (!placement) return { ok: false, message: "the poster agent could not place that" };
    return { ok: true, placement };
  } catch {
    return { ok: false, message: "the poster agent is not answering" };
  }
}

export function agentHeaders(internalToken: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (internalToken.length > 0) headers.authorization = `Bearer ${internalToken}`;
  return headers;
}

export function endpoint(base: string, path: string): string {
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${trimmed}${path}`;
}
