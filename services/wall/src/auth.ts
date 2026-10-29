import { scrypt as scryptCb, randomBytes, timingSafeEqual } from "node:crypto";

const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,22}[\p{L}\p{N}]$/u;

export function validName(name: string): boolean {
  return NAME.test(name);
}

export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "use at least 8 characters";
  if (password.length > 72) return "that password is too long";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scryptKey(password, salt);
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = parts[1];
  const expected = parts[2];
  if (!salt || !expected) return false;
  const derived = await scryptKey(password, salt);
  const actual = Buffer.from(derived);
  const target = Buffer.from(expected, "base64url");
  if (actual.length !== target.length) return false;
  return timingSafeEqual(actual, target);
}

export function sessionCookie(sessionId: string): string {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return `wall_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return `wall_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return part.slice(eq + 1).trim();
  }
  return null;
}

function scryptKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, 32, (error, derived) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derived);
    });
  });
}
