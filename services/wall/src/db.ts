import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

import { parseJson } from "@demo-wall/observability";

export type PublicUser = {
  id: string;
  displayName: string;
};

export type StoredUser = PublicUser & {
  passwordHash: string;
};

export type DraftStatus = "streaming" | "ready" | "approved" | "failed";

export type Draft = {
  id: string;
  userId: string;
  sessionId: string;
  notes: string;
  snippets: string[];
  greeting: string;
  status: DraftStatus;
  createdAt: string;
};

export type Poster = {
  id: string;
  userId: string;
  displayName: string;
  greeting: string;
  category: string;
  categoryLabel: string;
  group: string;
  createdAt: string;
};

export type BoardSummary = {
  category: string;
  categoryLabel: string;
  count: number;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  notes TEXT NOT NULL,
  snippets_json TEXT NOT NULL,
  greeting TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS posters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  draft_id TEXT NOT NULL UNIQUE,
  greeting TEXT NOT NULL,
  notes TEXT NOT NULL,
  snippets_json TEXT NOT NULL,
  category TEXT NOT NULL,
  category_label TEXT NOT NULL,
  group_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS posters_by_category ON posters(category, created_at DESC);
`;

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export function failLeftoverDrafts(db: DatabaseSync): void {
  db.prepare("UPDATE drafts SET status = 'failed' WHERE status = 'streaming'").run();
}

export function createUser(
  db: DatabaseSync,
  input: { id: string; displayName: string; passwordHash: string; createdAt: string },
): { ok: true } | { ok: false; reason: "taken" } {
  try {
    db.prepare(
      "INSERT INTO users (id, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)",
    ).run(input.id, input.displayName, input.passwordHash, input.createdAt);
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) return { ok: false, reason: "taken" };
    throw error;
  }
}

export function findUserByName(db: DatabaseSync, displayName: string): StoredUser | null {
  const row = one(
    db.prepare(
      "SELECT id, display_name, password_hash FROM users WHERE display_name = ? COLLATE NOCASE",
    ),
    displayName,
  );
  if (!row) return null;
  return {
    id: text(row, "id"),
    displayName: text(row, "display_name"),
    passwordHash: text(row, "password_hash"),
  };
}

export function findUserById(db: DatabaseSync, id: string): PublicUser | null {
  const row = one(db.prepare("SELECT id, display_name FROM users WHERE id = ?"), id);
  if (!row) return null;
  return { id: text(row, "id"), displayName: text(row, "display_name") };
}

export function createSession(db: DatabaseSync, userId: string): string {
  const id = newId("ses");
  db.prepare("INSERT INTO sessions (id, user_id, created_at) VALUES (?, ?, ?)").run(
    id,
    userId,
    new Date().toISOString(),
  );
  return id;
}

export function deleteSession(db: DatabaseSync, sessionId: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function findSession(db: DatabaseSync, sessionId: string): { sessionId: string; user: PublicUser } | null {
  const row = one(
    db.prepare(
      `SELECT sessions.id AS session_id, users.id AS id, users.display_name AS display_name
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ?`,
    ),
    sessionId,
  );
  if (!row) return null;
  return {
    sessionId: text(row, "session_id"),
    user: { id: text(row, "id"), displayName: text(row, "display_name") },
  };
}

export function createDraft(
  db: DatabaseSync,
  input: { id: string; userId: string; sessionId: string; notes: string; snippets: readonly string[] },
): Draft {
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO drafts (id, user_id, session_id, notes, snippets_json, greeting, status, created_at)
     VALUES (?, ?, ?, ?, ?, '', 'streaming', ?)`,
  ).run(input.id, input.userId, input.sessionId, input.notes, JSON.stringify(input.snippets), createdAt);
  return {
    id: input.id,
    userId: input.userId,
    sessionId: input.sessionId,
    notes: input.notes,
    snippets: [...input.snippets],
    greeting: "",
    status: "streaming",
    createdAt,
  };
}

export function findDraft(db: DatabaseSync, id: string): Draft | null {
  const row = one(
    db.prepare(
      `SELECT id, user_id, session_id, notes, snippets_json, greeting, status, created_at
       FROM drafts WHERE id = ?`,
    ),
    id,
  );
  if (!row) return null;
  return {
    id: text(row, "id"),
    userId: text(row, "user_id"),
    sessionId: text(row, "session_id"),
    notes: text(row, "notes"),
    snippets: decodeSnippets(text(row, "snippets_json")),
    greeting: text(row, "greeting"),
    status: draftStatus(text(row, "status")),
    createdAt: text(row, "created_at"),
  };
}

export function markDraftReady(db: DatabaseSync, id: string, greeting: string): void {
  db.prepare("UPDATE drafts SET greeting = ?, status = 'ready' WHERE id = ? AND status = 'streaming'").run(
    greeting,
    id,
  );
}

export function markDraftFailed(db: DatabaseSync, id: string): void {
  db.prepare("UPDATE drafts SET status = 'failed' WHERE id = ? AND status = 'streaming'").run(id);
}

export function publishPoster(
  db: DatabaseSync,
  input: {
    userId: string;
    draftId: string;
    placement: { category: string; categoryLabel: string; group: string };
  },
): { ok: true; poster: Poster } | { ok: false; error: "not_found" | "not_ready" | "already" } {
  db.exec("BEGIN IMMEDIATE");
  try {
    const draft = findDraft(db, input.draftId);
    if (!draft || draft.userId !== input.userId) {
      db.exec("ROLLBACK");
      return { ok: false, error: "not_found" };
    }
    if (draft.status === "approved") {
      db.exec("ROLLBACK");
      return { ok: false, error: "already" };
    }
    if (draft.status !== "ready" || draft.greeting.trim().length === 0) {
      db.exec("ROLLBACK");
      return { ok: false, error: "not_ready" };
    }
    const user = findUserById(db, input.userId);
    if (!user) {
      db.exec("ROLLBACK");
      return { ok: false, error: "not_found" };
    }
    const poster: Poster = {
      id: newId("pst"),
      userId: user.id,
      displayName: user.displayName,
      greeting: draft.greeting,
      category: input.placement.category,
      categoryLabel: input.placement.categoryLabel,
      group: input.placement.group,
      createdAt: new Date().toISOString(),
    };
    db.prepare(
      `INSERT INTO posters (
        id, user_id, display_name, draft_id, greeting, notes, snippets_json,
        category, category_label, group_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      poster.id,
      poster.userId,
      poster.displayName,
      draft.id,
      poster.greeting,
      draft.notes,
      JSON.stringify(draft.snippets),
      poster.category,
      poster.categoryLabel,
      poster.group,
      poster.createdAt,
    );
    db.prepare("UPDATE drafts SET status = 'approved' WHERE id = ?").run(draft.id);
    db.exec("COMMIT");
    return { ok: true, poster };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function insertFixturePoster(
  db: DatabaseSync,
  input: Poster & { draftId: string; notes: string; snippets: readonly string[] },
): void {
  db.prepare(
    `INSERT INTO posters (
      id, user_id, display_name, draft_id, greeting, notes, snippets_json,
      category, category_label, group_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.userId,
    input.displayName,
    input.draftId,
    input.greeting,
    input.notes,
    JSON.stringify(input.snippets),
    input.category,
    input.categoryLabel,
    input.group,
    input.createdAt,
  );
}

export function listBoards(db: DatabaseSync): BoardSummary[] {
  return many(
    db.prepare(
      `SELECT category, category_label, COUNT(*) AS count
       FROM posters
       GROUP BY category, category_label
       ORDER BY count DESC, category_label COLLATE NOCASE ASC`,
    ),
  ).map((row) => ({
    category: text(row, "category"),
    categoryLabel: text(row, "category_label"),
    count: countOf(row, "count"),
  }));
}

export function listPosters(db: DatabaseSync, category: string): Poster[] {
  return many(
    db.prepare(
      `SELECT id, user_id, display_name, greeting, category, category_label, group_name, created_at
       FROM posters WHERE category = ? ORDER BY created_at DESC`,
    ),
    category,
  ).map((row) => ({
    id: text(row, "id"),
    userId: text(row, "user_id"),
    displayName: text(row, "display_name"),
    greeting: text(row, "greeting"),
    category: text(row, "category"),
    categoryLabel: text(row, "category_label"),
    group: text(row, "group_name"),
    createdAt: text(row, "created_at"),
  }));
}

export function posterCount(db: DatabaseSync): number {
  const row = one(db.prepare("SELECT COUNT(*) AS count FROM posters"));
  if (!row) return 0;
  return countOf(row, "count");
}

function decodeSnippets(value: string): string[] {
  const parsed = parseJson(value);
  if (!parsed.ok || !Array.isArray(parsed.value)) throw new Error("bad snippets");
  const snippets: string[] = [];
  for (const item of parsed.value) {
    if (typeof item !== "string") throw new Error("bad snippet");
    snippets.push(item);
  }
  return snippets;
}

function draftStatus(value: string): DraftStatus {
  if (value === "streaming" || value === "ready" || value === "approved" || value === "failed") return value;
  throw new Error("bad draft status");
}

function one(statement: StatementSync, ...params: SQLInputValue[]): Record<string, unknown> | null {
  const value: unknown = statement.get(...params);
  return rowObject(value);
}

function many(statement: StatementSync, ...params: SQLInputValue[]): Record<string, unknown>[] {
  const value: unknown = statement.all(...params);
  if (!Array.isArray(value)) return [];
  const rows: Record<string, unknown>[] = [];
  for (const item of value) {
    const row = rowObject(item);
    if (row) rows.push(row);
  }
  return rows;
}

function rowObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  const row: Record<string, unknown> = {};
  for (const [key, cell] of Object.entries(value)) row[key] = cell;
  return row;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`bad column ${key}`);
  return value;
}

function countOf(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`bad count ${key}`);
}
