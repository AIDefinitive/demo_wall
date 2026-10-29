const OPENERS = [
  "hey. leave this where future you will actually see it.",
  "okay. this wanted to be a poster.",
  "pin this. not in a notes app. here.",
  "for you, out loud, on purpose.",
] as const;

const CLOSERS = [
  "say the true part twice. that's the spell.",
  "you don't have to be louder. you have to be specific.",
  "keep this version. the other one can rest.",
  "this is the line you were circling.",
] as const;

export function composeGreeting(notes: string, snippets: string[]): string {
  const sentence = firstSentence(notes);
  const pocket = snippets.slice(0, 3);
  const pocketLine =
    pocket.length > 0
      ? `pocket line: ${pocket.map((snippet) => `“${snippet}”`).join("  ·  ")}`
      : "no pocket line. the note is the whole thing.";
  const lines = [pick(OPENERS, notes), sentence, pocketLine, pick(CLOSERS, `${notes}:${pocket.join("|")}`)];
  return lines.join("\n\n");
}

export function streamPieces(greeting: string): string[] {
  const pieces: string[] = [];
  const lines = greeting.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const parts = line.split(/(\s+)/).filter((part) => part.length > 0);
    pieces.push(...parts);
    if (index < lines.length - 1) pieces.push("\n");
  }
  return pieces;
}

export function firstSentence(notes: string): string {
  const trimmed = notes.replace(/\s+/g, " ").trim();
  const match = /^([\s\S]{1,180}?[.!?])(?:\s|$)/.exec(trimmed);
  const sentence = match?.[1];
  if (sentence) return sentence;
  if (trimmed.length <= 180) return trimmed;
  return `${trimmed.slice(0, 177)}...`;
}

function pick<T>(items: readonly T[], seed: string): T {
  const index = hash(seed) % items.length;
  const item = items[index];
  if (item === undefined) throw new Error("empty catalog");
  return item;
}

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 33 + char.charCodeAt(0)) >>> 0;
  return value;
}
