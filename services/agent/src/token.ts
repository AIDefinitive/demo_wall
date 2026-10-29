import { timingSafeEqual } from "node:crypto";

export function bearerOk(header: string | undefined, expected: string): boolean {
  if (expected.length === 0) return true;
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice("Bearer ".length));
  const required = Buffer.from(expected);
  if (provided.length !== required.length) return false;
  return timingSafeEqual(provided, required);
}
