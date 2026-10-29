const DRAFT_KEY = "hey-wall:draftId";
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,22}[\p{L}\p{N}]$/u;

type Me = { id: string; displayName: string };
type BoardSummary = { category: string; categoryLabel: string; count: number };
type Poster = {
  id: string;
  displayName: string;
  greeting: string;
  category: string;
  categoryLabel: string;
  group: string;
  createdAt: string;
  mine: boolean;
};
type BoardDetail = { category: string; categoryLabel: string; groups: { name: string; posters: Poster[] }[] };
type Shell = {
  error: HTMLElement;
  chips: HTMLElement;
  notes: HTMLTextAreaElement;
  snippetInput: HTMLInputElement;
  snippetList: HTMLElement;
  poster: HTMLElement;
  approve: HTMLButtonElement;
  status: HTMLElement;
  board: HTMLElement;
  submit: HTMLButtonElement;
  composer: HTMLElement;
};

const appRoot = document.querySelector("#app");
if (!(appRoot instanceof HTMLElement)) throw new Error("missing app");

let shell: Shell | null = null;
let snippets: string[] = [];
let draftId: string | null = null;
let phase: "idle" | "streaming" | "ready" | "approved" = "idle";
let streamGen = 0;
let boardGen = 0;

window.addEventListener("hashchange", () => {
  void refreshBoards().catch((caught: unknown) => showError(caught));
});

void boot();

async function boot(): Promise<void> {
  try {
    await enter();
  } catch (caught) {
    renderAuth(caught instanceof Error ? caught.message : "the wall is not answering");
  }
}

async function enter(): Promise<void> {
  const user = await loadMe();
  if (!user) {
    renderAuth(null);
    return;
  }
  shell = renderShell(user);
  try {
    await restoreDraft();
    await refreshBoards();
  } catch (caught) {
    showError(caught);
  }
}

async function loadMe(): Promise<Me | null> {
  const response = await fetch("/api/me", { credentials: "same-origin" });
  if (response.status === 401) return null;
  const body = parseJson(await response.text());
  if (!response.ok) throw new Error(messageFrom(body) ?? "the wall is not answering");
  const user = objectField(body, "user");
  if (!user || typeof user.id !== "string" || typeof user.displayName !== "string") {
    throw new Error("the wall sent something unexpected");
  }
  return { id: user.id, displayName: user.displayName };
}

function renderAuth(message: string | null): void {
  shell = null;
  clear(appRoot);
  const gate = el("section", "gate");
  const copy = el("div");
  copy.append(
    el("p", "eyebrow", "hey wall"),
    el("h1", undefined, "say it on the wall"),
    el(
      "p",
      "lede",
      "Drop a note and a few snippets. The poster streams in front of you. It stays off the wall until you approve it.",
    ),
    el("p", "lede", "nova, rio, and mica already left posters. sign up and read the other boards."),
    el("span", "sticker", "not a feed"),
  );
  const form = el("form", "paper auth-form");
  const name = labeledInput("Name", "text", "username");
  const password = labeledInput("Password", "password", "current-password");
  name.input.maxLength = 24;
  password.input.maxLength = 72;
  const error = el("p", "alert");
  error.setAttribute("role", "alert");
  if (message) error.textContent = message;
  const submit = el("button", "primary", "come in");
  submit.type = "submit";
  const toggle = el("button", "ghost", "new here");
  toggle.type = "button";
  let mode: "login" | "signup" = "login";
  toggle.addEventListener("click", () => {
    mode = mode === "login" ? "signup" : "login";
    submit.textContent = mode === "login" ? "come in" : "make my name";
    toggle.textContent = mode === "login" ? "new here" : "I already have a name";
    password.input.autocomplete = mode === "login" ? "current-password" : "new-password";
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void authenticate(mode, name.input.value, password.input.value, error, submit);
  });
  form.append(name.label, password.label, error, submit, toggle);
  gate.append(copy, form);
  appRoot.append(gate);
}

async function authenticate(
  mode: "login" | "signup",
  displayNameRaw: string,
  password: string,
  error: HTMLElement,
  submit: HTMLButtonElement,
): Promise<void> {
  const displayName = displayNameRaw.trim();
  if (!NAME.test(displayName)) {
    error.textContent = "use 2 to 24 letters or numbers";
    return;
  }
  if (password.length < 8) {
    error.textContent = "use at least 8 characters";
    return;
  }
  submit.disabled = true;
  try {
    const response = await fetch(mode === "signup" ? "/api/signup" : "/api/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName, password }),
    });
    if (!response.ok) {
      error.textContent = await errorMessage(response);
      return;
    }
    await enter();
  } catch (caught) {
    error.textContent = caught instanceof Error ? caught.message : "the wall is not answering";
  } finally {
    submit.disabled = false;
  }
}

function renderShell(user: Me): Shell {
  clear(appRoot);
  const root = el("div", "shell");
  const error = el("p", "banner");
  error.setAttribute("role", "alert");
  const top = el("header", "top");
  const brand = el("div");
  const wordmark = el("a", "wordmark", "HEY WALL");
  wordmark.href = "#/make";
  brand.append(el("p", "eyebrow", "community wall"), wordmark);
  const who = el("div", "who");
  who.append(el("span", undefined, user.displayName));
  const logout = el("button", "ghost", "log out");
  logout.type = "button";
  logout.addEventListener("click", () => {
    void logOut();
  });
  who.append(logout);
  top.append(brand, who);

  const chips = el("nav", "chips");
  chips.setAttribute("aria-label", "categories");

  const studio = el("div", "studio");
  const composer = el("section", "paper composer");
  composer.append(
    el("p", "kicker", "make a poster"),
    el("h2", undefined, "notes in. greeting out."),
    el("p", "hint", "snippets can show up on the poster. the rest of the note stays with you."),
  );
  const notesLabel = el("label", undefined, "Note");
  const notes = el("textarea");
  notes.maxLength = 2000;
  notes.placeholder = "what should the poster hold?";
  notes.id = "note";
  notesLabel.htmlFor = "note";
  notesLabel.append(notes);
  notes.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submitDraft();
    }
  });
  const snippetLabel = el("label", undefined, "Snippet");
  const snippetRow = el("div", "snippet-row");
  const snippetInput = el("input");
  snippetInput.maxLength = 120;
  snippetInput.placeholder = "a short line to keep";
  snippetInput.id = "snippet";
  snippetLabel.htmlFor = "snippet";
  const add = el("button", "tiny", "add");
  add.type = "button";
  add.addEventListener("click", () => addSnippet());
  snippetInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addSnippet();
    }
  });
  snippetRow.append(snippetInput, add);
  snippetLabel.append(snippetRow);
  const snippetList = el("div", "snippet-list");
  const actions = el("div", "actions");
  const submit = el("button", "primary", "stream the poster");
  submit.type = "button";
  submit.addEventListener("click", () => {
    void submitDraft();
  });
  const again = el("button", "ghost", "run it again");
  again.type = "button";
  again.addEventListener("click", () => {
    void submitDraft();
  });
  actions.append(submit, again);
  composer.append(notesLabel, snippetLabel, snippetList, actions);

  const stage = el("section", "stage");
  const poster = el("p", "poster is-empty", "your poster shows up here, one line at a time.");
  poster.setAttribute("role", "status");
  poster.setAttribute("aria-live", "polite");
  const status = el("p", "status", "nothing is public until you stick it up.");
  const approve = el("button", "primary lime", "stick it up");
  approve.type = "button";
  approve.disabled = true;
  approve.addEventListener("click", () => {
    void approveDraft();
  });
  stage.append(poster, status, approve);
  studio.append(composer, stage);
  const board = el("section", "board");
  root.append(error, top, chips, studio, board);
  appRoot.append(root);
  wordmark.addEventListener("click", (event) => {
    event.preventDefault();
    window.location.hash = "#/make";
    composer.scrollIntoView({ behavior: motion(), block: "start" });
  });
  const built: Shell = { error, chips, notes, snippetInput, snippetList, poster, approve, status, board, submit, composer };
  shell = built;
  renderSnippets();
  return built;
}

function addSnippet(): void {
  if (!shell) return;
  const value = shell.snippetInput.value.replace(/\s+/g, " ").trim();
  shell.error.textContent = "";
  if (value.length === 0) return;
  if (value.length > 120) {
    shell.error.textContent = "keep each snippet under 120 characters";
    return;
  }
  if (snippets.length >= 8) {
    shell.error.textContent = "eight snippets is the max";
    return;
  }
  if (!snippets.includes(value)) snippets.push(value);
  shell.snippetInput.value = "";
  renderSnippets();
}

function renderSnippets(): void {
  if (!shell) return;
  clear(shell.snippetList);
  if (snippets.length === 0) {
    shell.snippetList.append(el("span", "hint", "no snippets yet"));
    return;
  }
  for (const snippet of snippets) {
    const chip = el("button", "tiny", snippet);
    chip.type = "button";
    chip.addEventListener("click", () => {
      snippets = snippets.filter((item) => item !== snippet);
      renderSnippets();
    });
    shell.snippetList.append(chip);
  }
}

async function submitDraft(): Promise<void> {
  if (!shell || phase === "streaming") return;
  const notes = shell.notes.value.replace(/\s+/g, " ").trim();
  if (notes.length < 8) {
    shell.error.textContent = "give the note at least a few words";
    return;
  }
  const gen = ++streamGen;
  phase = "streaming";
  draftId = null;
  shell.error.textContent = "";
  shell.poster.textContent = "";
  shell.poster.classList.add("is-streaming");
  shell.poster.classList.remove("is-empty");
  shell.approve.disabled = true;
  shell.submit.disabled = true;
  shell.status.textContent = "drafting…";
  try {
    const response = await fetch("/api/drafts", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes, snippets }),
    });
    if (gen !== streamGen) return;
    if (!response.ok || !response.body) {
      phase = "idle";
      shell.error.textContent = await errorMessage(response);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let greeting = "";
    let failed = false;
    while (true) {
      const chunk = await reader.read();
      if (gen !== streamGen || !shell) return;
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const parsed = takeEvents(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        if (event.event === "draft") {
          const id = stringField(event.data, "draftId");
          if (id) {
            draftId = id;
            storageSet(DRAFT_KEY, id);
          }
        } else if (event.event === "delta") {
          const text = stringField(event.data, "text");
          if (text) {
            greeting += text;
            shell.poster.textContent = greeting;
          }
        } else if (event.event === "poster") {
          const full = stringField(event.data, "greeting");
          if (full) {
            greeting = full;
            shell.poster.textContent = full;
          }
        } else if (event.event === "error") {
          failed = true;
          shell.error.textContent = stringField(event.data, "message") ?? "the poster did not finish";
        }
      }
    }
    if (!shell || gen !== streamGen) return;
    if (!failed && greeting.length > 0) {
      phase = "ready";
      shell.approve.disabled = false;
      shell.status.textContent = "read it. stick it up if it sounds like you.";
    } else {
      phase = "idle";
      if (!failed) shell.error.textContent = "the poster did not finish";
    }
  } catch (caught) {
    phase = "idle";
    showError(caught);
  } finally {
    if (shell && gen === streamGen) {
      shell.poster.classList.remove("is-streaming");
      shell.submit.disabled = false;
    }
  }
}

async function approveDraft(): Promise<void> {
  if (!shell || !draftId || phase !== "ready") return;
  shell.approve.disabled = true;
  try {
    const response = await fetch(`/api/drafts/${encodeURIComponent(draftId)}/approve`, {
      method: "POST",
      credentials: "same-origin",
    });
    const body = parseJson(await response.text());
    if (!response.ok) {
      shell.approve.disabled = false;
      shell.error.textContent = messageFrom(body) ?? "could not stick that up";
      return;
    }
    phase = "approved";
    storageRemove(DRAFT_KEY);
    const placement = objectField(body, "placement");
    const label = placement ? stringFieldOf(placement, "categoryLabel") : null;
    const category = placement ? stringFieldOf(placement, "category") : null;
    shell.status.textContent = label ? `on the wall, in ${label}.` : "on the wall.";
    if (category) selectCategory(category);
  } catch (caught) {
    shell.approve.disabled = false;
    showError(caught);
  }
}

async function restoreDraft(): Promise<void> {
  if (!shell) return;
  const saved = storageGet(DRAFT_KEY);
  if (!saved) return;
  const response = await fetch(`/api/drafts/${encodeURIComponent(saved)}`, { credentials: "same-origin" });
  if (response.status === 404) {
    storageRemove(DRAFT_KEY);
    return;
  }
  const body = parseJson(await response.text());
  if (!response.ok) return;
  const draft = objectField(body, "draft");
  if (!draft) return;
  if (typeof draft.notes === "string") shell.notes.value = draft.notes;
  if (Array.isArray(draft.snippets)) {
    snippets = draft.snippets.filter((item): item is string => typeof item === "string");
    renderSnippets();
  }
  if (draft.status === "approved") {
    storageRemove(DRAFT_KEY);
    return;
  }
  if (draft.status === "ready" && typeof draft.greeting === "string" && typeof draft.id === "string") {
    draftId = draft.id;
    phase = "ready";
    shell.poster.textContent = draft.greeting;
    shell.poster.classList.remove("is-empty");
    shell.approve.disabled = false;
    shell.status.textContent = "read it. stick it up if it sounds like you.";
    return;
  }
  shell.status.textContent = "that one didn't finish. stream it again.";
}

async function refreshBoards(): Promise<void> {
  if (!shell) return;
  const gen = ++boardGen;
  const listed = readBoards(await apiGet("/api/boards"));
  if (!shell || gen !== boardGen) return;
  const wanted = categoryFromHash();
  const known = listed.some((board) => board.category === wanted);
  const selected = known ? wanted : (listed[0]?.category ?? null);
  renderChips(listed, selected);
  if (wanted && !known) {
    renderEmptyBoard("that board is empty.");
    return;
  }
  if (!selected) {
    renderEmptyBoard("the wall is quiet. make the first poster.");
    return;
  }
  const detail = readBoard(await apiGet(`/api/boards/${encodeURIComponent(selected)}`));
  if (!shell || gen !== boardGen) return;
  renderBoard(detail);
}

function renderChips(boards: readonly BoardSummary[], selected: string | null): void {
  if (!shell) return;
  clear(shell.chips);
  for (const board of boards) {
    const chip = el("button", "chip", `${board.categoryLabel} · ${board.count}`);
    chip.type = "button";
    chip.dataset.category = board.category;
    chip.setAttribute("aria-pressed", board.category === selected ? "true" : "false");
    chip.addEventListener("click", () => selectCategory(board.category));
    shell.chips.append(chip);
  }
}

function renderBoard(detail: BoardDetail): void {
  if (!shell) return;
  clear(shell.board);
  shell.board.append(el("p", "kicker", "category board"), el("h2", undefined, detail.categoryLabel));
  const lanes = el("div", "lanes");
  for (const group of detail.groups) {
    const lane = el("section", "lane");
    lane.append(el("h3", undefined, group.name));
    for (const poster of group.posters) {
      const card = el("article", "card");
      const by = el("div", "byline");
      by.append(el("span", undefined, poster.displayName));
      if (poster.mine) by.append(el("span", "you", "you"));
      const when = formatWhen(poster.createdAt);
      if (when) by.append(el("span", undefined, when));
      const copy = el("p");
      copy.textContent = poster.greeting;
      card.append(by, copy);
      lane.append(card);
    }
    lanes.append(lane);
  }
  shell.board.append(lanes);
}

function renderEmptyBoard(message: string): void {
  if (!shell) return;
  clear(shell.board);
  shell.board.append(el("p", "kicker", "category board"), el("h2", undefined, message));
}

function selectCategory(category: string): void {
  const next = `#/board/${category}`;
  shell?.board.scrollIntoView({ behavior: motion(), block: "start" });
  if (window.location.hash === next) {
    void refreshBoards().catch((caught: unknown) => showError(caught));
    return;
  }
  window.location.hash = next;
}

async function logOut(): Promise<void> {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  storageRemove(DRAFT_KEY);
  snippets = [];
  draftId = null;
  phase = "idle";
  renderAuth(null);
}

async function apiGet(path: string): Promise<unknown> {
  const response = await fetch(path, { credentials: "same-origin" });
  const body = parseJson(await response.text());
  if (!response.ok) throw new Error(messageFrom(body) ?? "the wall could not do that");
  return body;
}

function readBoards(value: unknown): BoardSummary[] {
  if (!isRecord(value) || !Array.isArray(value.boards)) throw new Error("the wall sent something unexpected");
  const boards: BoardSummary[] = [];
  for (const item of value.boards) {
    if (!isRecord(item)) continue;
    if (typeof item.category !== "string" || typeof item.categoryLabel !== "string" || typeof item.count !== "number") {
      continue;
    }
    boards.push({ category: item.category, categoryLabel: item.categoryLabel, count: item.count });
  }
  return boards;
}

function readBoard(value: unknown): BoardDetail {
  if (
    !isRecord(value) ||
    typeof value.category !== "string" ||
    typeof value.categoryLabel !== "string" ||
    !Array.isArray(value.groups)
  ) {
    throw new Error("the wall sent something unexpected");
  }
  const groups: BoardDetail["groups"] = [];
  for (const group of value.groups) {
    if (!isRecord(group) || typeof group.name !== "string" || !Array.isArray(group.posters)) continue;
    const posters: Poster[] = [];
    for (const poster of group.posters) {
      const parsed = readPoster(poster);
      if (parsed) posters.push(parsed);
    }
    groups.push({ name: group.name, posters });
  }
  return { category: value.category, categoryLabel: value.categoryLabel, groups };
}

function readPoster(value: unknown): Poster | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.greeting !== "string" ||
    typeof value.category !== "string" ||
    typeof value.categoryLabel !== "string" ||
    typeof value.group !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.mine !== "boolean"
  ) {
    return null;
  }
  return {
    id: value.id,
    displayName: value.displayName,
    greeting: value.greeting,
    category: value.category,
    categoryLabel: value.categoryLabel,
    group: value.group,
    createdAt: value.createdAt,
    mine: value.mine,
  };
}

function takeEvents(buffer: string): { events: { event: string; data: string }[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: { event: string; data: string }[] = [];
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

async function errorMessage(response: Response): Promise<string> {
  try {
    return messageFrom(parseJson(await response.text())) ?? "the wall could not do that";
  } catch {
    return "the wall could not do that";
  }
}

function showError(caught: unknown): void {
  if (!shell) return;
  shell.error.textContent = caught instanceof Error ? caught.message : "the wall is not answering";
}

function messageFrom(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.message === "string" ? value.message : null;
}

function objectField(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const cell = value[key];
  return isRecord(cell) ? cell : null;
}

function stringField(data: string, key: string): string | null {
  const parsed = parseJson(data);
  return isRecord(parsed) ? stringFieldOf(parsed, key) : null;
}

function stringFieldOf(value: Record<string, unknown>, key: string): string | null {
  const cell = value[key];
  return typeof cell === "string" ? cell : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function categoryFromHash(): string | null {
  const match = /^#\/board\/([a-z0-9-]{1,40})$/.exec(window.location.hash);
  return match?.[1] ?? null;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

function motion(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // private mode can refuse storage. the poster still streams.
  }
}

function storageRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function labeledInput(
  text: string,
  type: string,
  autocomplete: string,
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = el("label");
  const input = el("input");
  const id = text.toLowerCase().replace(/\s+/g, "-");
  input.id = id;
  input.type = type;
  input.autocomplete = autocomplete;
  input.required = true;
  label.htmlFor = id;
  label.append(document.createTextNode(text), input);
  return { label, input };
}

function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
