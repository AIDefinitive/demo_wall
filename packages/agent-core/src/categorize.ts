export type Placement = {
  category: string;
  categoryLabel: string;
  group: string;
};

type Category = {
  id: string;
  label: string;
  group: string;
  words: readonly string[];
};

export const CATEGORIES: readonly Category[] = [
  {
    id: "soft-hours",
    label: "soft hours",
    group: "keep it close",
    words: ["tired", "sleep", "quiet", "soft", "gentle", "night", "cry"],
  },
  {
    id: "low-battery",
    label: "low battery",
    group: "keep it close",
    words: ["burnout", "exhausted", "empty", "drained", "overwhelmed", "cannot", "can't"],
  },
  {
    id: "glow-ups",
    label: "glow ups",
    group: "say it loud",
    words: ["proud", "win", "finally", "finished", "promoted", "glow"],
  },
  {
    id: "main-character",
    label: "main character",
    group: "say it loud",
    words: ["main character", "plot", "era", "iconic"],
  },
  {
    id: "for-the-groupchat",
    label: "for the groupchat",
    group: "pass it on",
    words: ["y'all", "yall", "friends", "group", "everyone", "we", "us"],
  },
  {
    id: "side-quests",
    label: "side quests",
    group: "pass it on",
    words: ["idea", "project", "build", "quest", "try"],
  },
  {
    id: "unfiled",
    label: "unfiled feelings",
    group: "keep it close",
    words: [],
  },
];

export function categorize(input: { notes: string; snippets: readonly string[]; greeting: string }): Placement {
  const text = `${input.notes}\n${input.snippets.join("\n")}\n${input.greeting}`.toLowerCase();
  const fallback = CATEGORIES.find((category) => category.id === "unfiled");
  if (!fallback) throw new Error("missing default category");
  let best = fallback;
  let bestScore = 0;
  for (const category of CATEGORIES) {
    if (category.id === "unfiled") continue;
    let score = 0;
    for (const word of category.words) {
      if (hasWord(text, word)) score += 1;
    }
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return { category: best.id, categoryLabel: best.label, group: best.group };
}

export function parsePlacement(value: unknown): Placement | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("category" in value) || !("categoryLabel" in value) || !("group" in value)) return null;
  const { category, categoryLabel, group } = value;
  if (typeof category !== "string" || typeof categoryLabel !== "string" || typeof group !== "string") {
    return null;
  }
  const known = CATEGORIES.find((item) => item.id === category);
  if (!known || known.label !== categoryLabel || known.group !== group) return null;
  return { category, categoryLabel, group };
}

function hasWord(text: string, word: string): boolean {
  const needle = word.toLowerCase();
  if (needle.includes(" ") || needle.includes("'")) return text.includes(needle);
  const pattern = new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i");
  return pattern.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
