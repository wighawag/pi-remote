// Saved drafts: messages the user chose to KEEP instead of sending.
//
// The store lives on the SERVER (`<config dir>/drafts.json`), not in a browser,
// because that is the whole point of wherever: the machine holds the state and
// any device picks it up. A draft written on a phone has to be there on the
// laptop, and clearing site data must not destroy it. (The composer's per-session
// AUTO-draft is a different thing and stays client-side: it is crash protection
// for the one text currently in the box, rewritten on every keystroke, and
// round-tripping that to the server per keystroke would be absurd.)
//
// Drafts are GLOBAL to a server, deliberately not scoped to a session: a prompt
// written while looking at one repo is often exactly what you want to send in
// another, and the home page (no session at all) is a place you want to load one.
// The originating session/cwd is retained as DISPLAY metadata only.
//
// This module is the ONE writer of the list: the client never merges, caps or
// dedupes a list of its own (it would be a second writer with no conflict rule,
// and the two would drift). Every mutation returns the whole new list, which the
// client adopts verbatim.

import fs from 'node:fs';
import path from 'node:path';
import { getWhereverConfigDir } from './session-pool.js';

/**
 * Hard cap on retained drafts, dropping the least recently touched. A draft is
 * kept forever by definition, so without a cap this file is the one thing here
 * that grows without bound.
 */
export const MAX_DRAFTS = 100;

/** Per-draft character cap. A composer message is prose, not a file paste. */
export const MAX_DRAFT_CHARS = 20000;

/**
 * Cap on the display metadata (`sessionId` / `cwd`). These are not user prose,
 * they are values the client already holds, so anything longer is a client bug
 * or an abuse attempt. Uncapped, ~100 saves of a 500 KB `cwd` would push the
 * file past MAX_DRAFTS_FILE_BYTES and make the whole list unreadable.
 */
export const MAX_DRAFT_META_CHARS = 1024;

/** Max bytes read from drafts.json. Belt-and-braces against a corrupt file. */
const MAX_DRAFTS_FILE_BYTES = 5 * 1024 * 1024;

export interface Draft {
  /** Stable id: the handle for load/delete. */
  id: string;
  /** The message text, trimmed. Never blank. */
  text: string;
  /** Epoch ms first saved. */
  createdAt: number;
  /** Epoch ms of the last save of this same text (drives list order). */
  updatedAt: number;
  /** Session it was written in, if any. Display metadata only. */
  sessionId?: string;
  /** Working folder it was written in, if any. Display metadata only. */
  cwd?: string;
}

interface DraftsFile {
  version: number;
  drafts: Draft[];
}

/**
 * The drafts file exists but cannot be trusted (unreadable, implausibly large,
 * or not parseable). Every mutation is a read-modify-write, so this MUST abort
 * the write rather than let an empty read overwrite the file: that file is the
 * only copy of text the user explicitly asked to keep, and treating "I could not
 * read it" as "it is empty" would delete every draft on the next save. Fail
 * closed, keep the file, and tell the user which file to look at.
 */
export class DraftsUnavailableError extends Error {
  constructor(reason: string) {
    super(`${getDraftsPath()} could not be read (${reason}). Drafts left untouched.`);
    this.name = 'DraftsUnavailableError';
  }
}

export function getDraftsPath(): string {
  return path.join(getWhereverConfigDir(), 'drafts.json');
}

/** Newest-updated first, ties broken by id so the order is deterministic. */
export function sortDrafts(drafts: Draft[]): Draft[] {
  return [...drafts].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

/**
 * Parse the file. Returns NULL when the content is not a drafts file at all
 * (truncated, corrupt, some other JSON), which callers must treat as "unknown",
 * never as "empty" -- see DraftsUnavailableError. A malformed MEMBER inside an
 * otherwise valid file is DROPPED rather than repaired: a draft is user-authored
 * text, and inventing fields for it is worse than losing the one broken record.
 * Accepts both the `{version, drafts}` envelope and a bare array, so a
 * hand-written file works too.
 */
export function parseDrafts(raw: string | null | undefined): Draft[] | null {
  if (raw == null) return null;
  if (raw.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as DraftsFile).drafts)
      ? (parsed as DraftsFile).drafts
      : null;
  if (!arr) return null;
  const out: Draft[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    if (typeof d.id !== 'string' || d.id.length === 0) continue;
    if (typeof d.text !== 'string') continue;
    const text = d.text.trim();
    if (text.length === 0) continue;
    const createdAt = typeof d.createdAt === 'number' ? d.createdAt : 0;
    const updatedAt = typeof d.updatedAt === 'number' ? d.updatedAt : createdAt;
    out.push({
      id: d.id,
      text,
      createdAt,
      updatedAt,
      ...(typeof d.sessionId === 'string' ? { sessionId: d.sessionId } : {}),
      ...(typeof d.cwd === 'string' ? { cwd: d.cwd } : {}),
    });
  }
  return sortDrafts(out);
}

export function serializeDrafts(drafts: Draft[]): string {
  const file: DraftsFile = { version: 1, drafts };
  return JSON.stringify(file, null, 2);
}

export interface SaveDraftInput {
  text: string;
  id: string;
  now: number;
  sessionId?: string;
  cwd?: string;
}

/**
 * Add `text` to the list, returning the new list (newest first).
 *
 * - Blank text saves nothing: a whitespace-only draft is indistinguishable from
 *   the others in a list and there would be no way to tell them apart.
 * - Text IDENTICAL to an existing draft does NOT duplicate it: the existing
 *   entry is touched (updatedAt) and floats to the top. Re-saving the same
 *   reusable prompt is the normal case, and a wall of identical rows is noise
 *   the user would then have to prune by hand.
 */
/**
 * Validate an incoming draft, returning an error message or null.
 *
 * ONE place decides what is acceptable, and the route turns a message into a
 * 400. Overlong text is REJECTED rather than truncated: the client clears the
 * composer once the server has the draft, so silently storing a prefix would
 * destroy the tail of the message with no error and no undo.
 */
export function validateDraftInput(input: {
  text: unknown;
  sessionId?: unknown;
  cwd?: unknown;
}): string | null {
  if (typeof input.text !== 'string' || input.text.trim().length === 0) {
    return 'A draft cannot be empty';
  }
  if (input.text.trim().length > MAX_DRAFT_CHARS) {
    return `A draft cannot exceed ${MAX_DRAFT_CHARS} characters`;
  }
  for (const [field, value] of [
    ['sessionId', input.sessionId],
    ['cwd', input.cwd],
  ] as const) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') return `${field} must be a string`;
    if (value.length > MAX_DRAFT_META_CHARS) {
      return `${field} cannot exceed ${MAX_DRAFT_META_CHARS} characters`;
    }
  }
  return null;
}

export function saveDraft(drafts: Draft[], input: SaveDraftInput): Draft[] {
  const text = input.text.trim();
  if (text.length === 0 || text.length > MAX_DRAFT_CHARS) return sortDrafts(drafts);
  const existing = drafts.find((d) => d.text === text);
  const next: Draft[] = existing
    ? drafts.map((d) => (d.id === existing.id ? { ...d, updatedAt: input.now } : d))
    : [
        {
          id: input.id,
          text,
          createdAt: input.now,
          updatedAt: input.now,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(input.cwd ? { cwd: input.cwd } : {}),
        },
        ...drafts,
      ];
  return sortDrafts(next).slice(0, MAX_DRAFTS);
}

export function removeDraft(drafts: Draft[], id: string): Draft[] {
  return sortDrafts(drafts.filter((d) => d.id !== id));
}

/**
 * Read the stored list. A MISSING file is genuinely an empty list; anything else
 * that goes wrong throws DraftsUnavailableError, so a mutation aborts instead of
 * overwriting a file it could not read (see that class). Callers that only
 * display the list can catch and show the error; none of them may swallow it and
 * carry on writing.
 */
export function readDrafts(): Draft[] {
  const file = getDraftsPath();
  let raw: string;
  try {
    if (!fs.existsSync(file)) return [];
    const stat = fs.statSync(file);
    if (stat.size > MAX_DRAFTS_FILE_BYTES) {
      throw new DraftsUnavailableError(`${stat.size} bytes, implausibly large`);
    }
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err instanceof DraftsUnavailableError) throw err;
    throw new DraftsUnavailableError((err as Error)?.message || 'read failed');
  }
  const parsed = parseDrafts(raw);
  if (parsed === null) {
    throw new DraftsUnavailableError('not a valid drafts file');
  }
  return parsed;
}

/**
 * Write the list. ATOMIC (tmp file + rename) because this file is the only copy
 * of text the user explicitly asked to keep: a torn write from a crash or a full
 * disk would otherwise lose every draft at once, and a truncated file is exactly
 * the case parseDrafts has to throw away.
 *
 * Sync fs on purpose (like getWhereverConfig): the file is a few KB and this
 * runs on a rare, human-initiated action, so there is nothing here to block the
 * event loop with. Anything that could grow (the session listing, transcripts)
 * is streamed elsewhere; this is not that.
 */
export function writeDrafts(drafts: Draft[]): void {
  const file = getDraftsPath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.drafts.json.${process.pid}.tmp`);
  try {
    // 0600: these are the user's unsent private words, not shared config.
    fs.writeFileSync(tmp, serializeDrafts(drafts), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw err;
  }
}

export function newDraftId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Save `input` and persist. Returns the new list. */
export function addDraft(input: Omit<SaveDraftInput, 'id' | 'now'> & Partial<Pick<SaveDraftInput, 'id' | 'now'>>): Draft[] {
  const next = saveDraft(readDrafts(), {
    text: input.text,
    id: input.id ?? newDraftId(),
    now: input.now ?? Date.now(),
    sessionId: input.sessionId,
    cwd: input.cwd,
  });
  writeDrafts(next);
  return next;
}

/** Delete by id and persist. Returns the new list. */
export function deleteDraft(id: string): Draft[] {
  const next = removeDraft(readDrafts(), id);
  writeDrafts(next);
  return next;
}
