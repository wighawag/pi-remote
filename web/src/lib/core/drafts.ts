// Client-side half of saved drafts (messages kept instead of sent).
//
// The STORE is server-side (`server/src/drafts.ts`, `<config dir>/drafts.json`):
// a draft saved on a phone has to be there on the laptop, so the machine holds
// it, not a browser. The server is therefore the ONLY writer: it owns the id,
// the dedupe, the cap and the ordering, and every mutation answers with the whole
// new list, which this client adopts verbatim. Nothing here merges lists.
//
// What lives here is what the server cannot know: what the composer should do
// when a draft is loaded into it. Plus a tolerant parse for the local MIRROR of
// the server list, which exists only so the drafts panel still renders something
// while disconnected (saving and deleting always need the server).
//
// This is deliberately a different thing from the composer's per-session
// AUTO-draft (`wherever-draft:<sessionId>`), which is invisible crash protection
// for the one text currently in the box, rewritten on every keystroke and
// cleared by a send. Round-tripping that to the server per keystroke would be
// absurd; a saved draft is an explicit, durable artifact and belongs on the
// machine.

/** localStorage mirror of the server list. Read-only cache: never uploaded. */
export const DRAFTS_CACHE_KEY = 'wherever-drafts-cache';

/**
 * The key the FIRST (browser-only) version of this feature wrote its drafts to.
 * Kept solely as a one-shot migration source: anything found here is pushed up
 * to the server and the key is then removed, so a draft written against a
 * pre-server build is not silently orphaned. Never written to again.
 */
export const LEGACY_DRAFTS_KEY = 'wherever-drafts';

export interface Draft {
	id: string;
	text: string;
	createdAt: number;
	updatedAt: number;
	/** Session it was written in, if any. Display metadata only. */
	sessionId?: string;
	/** Working folder it was written in, if any. Display metadata only. */
	cwd?: string;
}

/** Newest-updated first, ties broken by id so the order is deterministic. */
export function sortDrafts(drafts: Draft[]): Draft[] {
	return [...drafts].sort(
		(a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
	);
}

/**
 * Tolerant parse of a stored/received list. A corrupt cache (or a response from
 * something that is not a wherever server) must never take the composer down, so
 * anything unparseable yields an empty list and a malformed member is dropped
 * rather than repaired.
 */
export function parseDrafts(raw: string | null | undefined): Draft[] {
	if (!raw) return [];
	try {
		return normalizeDrafts(JSON.parse(raw));
	} catch {
		return [];
	}
}

/** Same tolerance, applied to an already-decoded value (an API response). */
export function normalizeDrafts(value: unknown): Draft[] {
	if (!Array.isArray(value)) return [];
	const out: Draft[] = [];
	for (const item of value) {
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
			...(typeof d.sessionId === 'string' ? {sessionId: d.sessionId} : {}),
			...(typeof d.cwd === 'string' ? {cwd: d.cwd} : {}),
		});
	}
	return sortDrafts(out);
}

export function serializeDrafts(drafts: Draft[]): string {
	return JSON.stringify(drafts);
}

/**
 * What loading a draft into the composer should do RIGHT NOW.
 *
 * `confirm` is the warning: the box already holds text the user has not sent,
 * and loading over it would silently destroy work. Whitespace is not work, so an
 * effectively empty box loads straight away.
 */
export function decideDraftLoad(currentText: string): 'load' | 'confirm' {
	return currentText.trim().length > 0 ? 'confirm' : 'load';
}

export type DraftLoadMode = 'replace' | 'append';

/**
 * The composer text after loading `draftText` into `currentText`.
 *
 * `append` is the non-destructive way out of the warning: keep what was typed
 * AND take the draft, separated by a blank line.
 */
export function applyDraft(
	currentText: string,
	draftText: string,
	mode: DraftLoadMode,
): string {
	if (mode === 'replace') return draftText;
	const current = currentText.replace(/\s+$/, '');
	if (current.length === 0) return draftText;
	return `${current}\n\n${draftText}`;
}

/**
 * Whether SENDING `sentText` consumes the draft that was loaded into the box.
 *
 * Mail-client semantics: loading a draft does NOT delete it (one mistap would
 * destroy the text with no undo), but actually SENDING it does -- an unsent
 * message that has now been sent is not a draft any more, and leaving it behind
 * turns the list into a pile of things the user already dealt with.
 *
 * The link is by CONTENT, not by a flag, and it matches EXACTLY the two shapes
 * applyDraft can produce: the draft alone (replace), or the draft as a SUFFIX
 * after typed text (append below). Deliberately not a substring test: a short
 * reusable prompt ("run the tests", "continue") would then be deleted whenever it
 * happened to appear inside an unrelated message sent later, which is the
 * data-losing direction. Anything else means the text was edited past the draft,
 * so the draft survives -- the safe side of a wrong guess.
 */
export function draftToConsumeOnSend(
	source: {id: string; text: string} | null,
	sentText: string,
): string | null {
	if (!source) return null;
	const sent = sentText.trim();
	if (sent.length === 0) return null;
	const draft = source.text.trim();
	if (draft.length === 0) return null;
	return sent === draft || sent.endsWith(`\n\n${draft}`) ? source.id : null;
}

/**
 * One-line preview for the drafts list: whitespace/newlines collapsed so a
 * multi-line message stays one row, truncated with an ellipsis.
 */
export function draftPreview(text: string, max = 140): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	if (flat.length <= max) return flat;
	return `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** Trailing folder name of a draft's origin cwd, for the list's context line. */
export function draftOriginLabel(draft: Draft): string | null {
	if (!draft.cwd) return null;
	const parts = draft.cwd.split('/').filter(Boolean);
	return parts.length > 0 ? parts[parts.length - 1] : draft.cwd;
}
