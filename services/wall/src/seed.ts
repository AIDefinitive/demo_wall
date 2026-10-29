import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { hashPassword } from "./auth.js";
import { createUser, insertFixturePoster, posterCount } from "./db.js";

const HOUSE = [
  {
    id: "usr_seed_nova",
    displayName: "nova",
    posterId: "pst_seed_nova_soft",
    draftId: "drf_seed_nova_soft",
    category: "soft-hours",
    categoryLabel: "soft hours",
    group: "keep it close",
    createdAt: "2026-10-27T02:12:00.000Z",
    notes: "quiet night after a long week",
    snippets: ["lamp on, phone down"],
    greeting: [
      "hey. the quiet counted too.",
      "you made it through a night that asked for nothing loud.",
      "pocket line: “lamp on, phone down”",
      "keep this version. the other one can rest.",
    ].join("\n\n"),
  },
  {
    id: "usr_seed_rio",
    displayName: "rio",
    posterId: "pst_seed_rio_glow",
    draftId: "drf_seed_rio_glow",
    category: "glow-ups",
    categoryLabel: "glow ups",
    group: "say it loud",
    createdAt: "2026-10-27T20:04:00.000Z",
    notes: "finished the thing I kept moving",
    snippets: ["it's done"],
    greeting: [
      "okay. this wanted to be a poster.",
      "you finished the thing you kept moving to next week.",
      "pocket line: “it's done”",
      "say the true part twice. that's the spell.",
    ].join("\n\n"),
  },
  {
    id: "usr_seed_mica",
    displayName: "mica",
    posterId: "pst_seed_mica_group",
    draftId: "drf_seed_mica_group",
    category: "for-the-groupchat",
    categoryLabel: "for the groupchat",
    group: "pass it on",
    createdAt: "2026-10-28T18:40:00.000Z",
    notes: "we do not have to pretend",
    snippets: ["tell them tonight"],
    greeting: [
      "for the group chat, and also for you.",
      "we do not have to pretend we were fine.",
      "pocket line: “tell them tonight”",
      "this is the line you were circling.",
    ].join("\n\n"),
  },
  {
    id: "usr_seed_rio",
    displayName: "rio",
    posterId: "pst_seed_rio_quest",
    draftId: "drf_seed_rio_quest",
    category: "side-quests",
    categoryLabel: "side quests",
    group: "pass it on",
    createdAt: "2026-10-28T15:15:00.000Z",
    notes: "a tiny project can be the plan",
    snippets: ["one weird page"],
    greeting: [
      "pin this. not in a notes app. here.",
      "a tiny project can be the whole plan.",
      "pocket line: “one weird page”",
      "you don't have to be louder. you have to be specific.",
    ].join("\n\n"),
  },
] as const;

export async function seedIfEmpty(db: DatabaseSync): Promise<void> {
  if (posterCount(db) > 0) return;
  const hashes = new Map<string, string>();
  for (const house of HOUSE) {
    if (hashes.has(house.id)) continue;
    hashes.set(house.id, await hashPassword(randomBytes(24).toString("base64url")));
  }
  for (const house of HOUSE) {
    const passwordHash = hashes.get(house.id);
    if (!passwordHash) continue;
    createUser(db, {
      id: house.id,
      displayName: house.displayName,
      passwordHash,
      createdAt: "2026-10-26T12:00:00.000Z",
    });
  }
  for (const house of HOUSE) {
    insertFixturePoster(db, {
      id: house.posterId,
      userId: house.id,
      displayName: house.displayName,
      draftId: house.draftId,
      greeting: house.greeting,
      notes: house.notes,
      snippets: house.snippets,
      category: house.category,
      categoryLabel: house.categoryLabel,
      group: house.group,
      createdAt: house.createdAt,
    });
  }
}
