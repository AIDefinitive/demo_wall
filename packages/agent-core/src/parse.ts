const ID = /^[A-Za-z0-9_-]{1,80}$/;

export type ComposeInput = {
  notes: string;
  snippets: string[];
};

export type MessageInput = ComposeInput & {
  userId: string;
  sessionId: string;
  draftId: string;
};

export type CategorizeInput = MessageInput & {
  greeting: string;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function parseComposeInput(value: unknown): ParseResult<ComposeInput> {
  if (!isRecord(value)) return fail("send notes as json");
  if (typeof value.notes !== "string") return fail("notes should be text");
  const notes = clean(value.notes);
  if (notes.length < 8) return fail("give the note at least a few words");
  if (notes.length > 2000) return fail("that note is too long");
  if (!Array.isArray(value.snippets)) return fail("snippets should be a list");
  if (value.snippets.length > 8) return fail("eight snippets is the max");
  const snippets: string[] = [];
  for (const snippet of value.snippets) {
    if (typeof snippet !== "string") return fail("each snippet should be text");
    const cleaned = clean(snippet);
    if (cleaned.length === 0) continue;
    if (cleaned.length > 120) return fail("keep each snippet under 120 characters");
    if (!snippets.includes(cleaned)) snippets.push(cleaned);
  }
  return { ok: true, value: { notes, snippets } };
}

export function parseMessageInput(value: unknown): ParseResult<MessageInput> {
  const compose = parseComposeInput(value);
  if (!compose.ok) return compose;
  if (!isRecord(value)) return fail("send notes as json");
  const userId = readId(value.userId, "userId");
  if (!userId.ok) return userId;
  const sessionId = readId(value.sessionId, "sessionId");
  if (!sessionId.ok) return sessionId;
  const draftId = readId(value.draftId, "draftId");
  if (!draftId.ok) return draftId;
  return {
    ok: true,
    value: {
      ...compose.value,
      userId: userId.value,
      sessionId: sessionId.value,
      draftId: draftId.value,
    },
  };
}

export function parseCategorizeInput(value: unknown): ParseResult<CategorizeInput> {
  const message = parseMessageInput(value);
  if (!message.ok) return message;
  if (!isRecord(value) || typeof value.greeting !== "string") return fail("greeting should be text");
  const greeting = value.greeting.replace(/\s+$/g, "").trim();
  if (greeting.length < 1 || greeting.length > 4000) return fail("that greeting cannot be categorized");
  return { ok: true, value: { ...message.value, greeting } };
}

function readId(value: unknown, label: string): ParseResult<string> {
  if (typeof value !== "string" || !ID.test(value)) return fail(`${label} is missing`);
  return { ok: true, value };
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function fail(message: string): ParseResult<never> {
  return { ok: false, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
