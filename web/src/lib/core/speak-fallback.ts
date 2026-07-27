// The SPOKEN-REPLY FALLBACK: what conversation mode speaks when the agent did
// not call `say` for a turn.
//
// WHY THIS EXISTS. Conversation mode's spoken reply was designed to come ONLY
// from the agent's explicit `say` call, and the agent is told a spoken
// conversation is active (the per-turn conversation-mode signal, ADR 0004). That
// is the right primary path: the agent authors a short spoken line, distinct from
// its full written answer. But it is a REQUEST, and compliance is a model
// property, not something the client controls. Measured against the local model a
// reported session actually ran on (a 35B), a turn with the injected hint called
// `say` roughly half the time, and almost never at the post-tool-result synthesis
// call. So a mode whose whole point is "I can listen to the reply" went silent for
// entire turns, and the user had to nag ("why don't you speak?") to get audio.
//
// The fallback closes that gap WITHOUT touching the agent contract: when a turn
// settles with spoken replies active and no `say` was spoken, the client speaks a
// short, plain-text lead-in derived from the written reply it already has. It is
// strictly a SAFETY NET:
// - `say` always wins (a turn that spoke is never re-spoken by the fallback),
// - the full written reply is never modified, hidden or truncated on screen, and
// - what is spoken is deliberately SHORT, because a whole written answer read
//   aloud (code blocks, URLs, bullet lists) is worse than useless.
//
// Pure and framework-free so it is unit-testable without jsdom, mirroring
// core/collapse-reply.ts and core/hands-free.ts.

/** Roughly how much of a written reply is worth reading aloud. */
export const FALLBACK_MAX_CHARS = 320;

/**
 * Turn a written markdown reply into something worth SPEAKING, or '' when there
 * is nothing speakable in it.
 *
 * Drops what is noise out loud rather than trying to read everything:
 * - fenced code blocks (and any reply that is only code speaks as ''),
 * - inline code/emphasis/heading/quote/list markers (the words are kept),
 * - link URLs (the link TEXT is kept: "see [the docs](http://...)" -> "see the docs"),
 * - bare URLs, which are unlistenable character by character.
 *
 * Then keeps the LEAD-IN only: whole sentences up to FALLBACK_MAX_CHARS (at least
 * one sentence, hard-capped mid-sentence with an ellipsis if that first sentence
 * is itself enormous). The written answer keeps every detail; this is the "what
 * happened" a listener needs to know whether to go and read it.
 */
export function spokenFallbackText(
	reply: string,
	maxChars = FALLBACK_MAX_CHARS,
): string {
	const withoutCode = (reply ?? '')
		// Fenced code blocks, including an unterminated trailing fence.
		.replace(/```[\s\S]*?(?:```|$)/g, ' ')
		// Indented code blocks are indistinguishable from wrapped prose often
		// enough that we leave them alone; inline code just loses its backticks.
		.replace(/`([^`]*)`/g, '$1');

	const plain = withoutCode
		// Images first (their alt text is rarely worth speaking), then links.
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		// Bare URLs read as gibberish out loud.
		.replace(/\bhttps?:\/\/\S+/gi, ' ')
		// Structural markers at the start of a line: heading, quote, list bullet.
		.replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d+[.)])[ \t]+/gm, '')
		// Horizontal rules.
		.replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, ' ')
		// Emphasis markers around words we still want to speak.
		.replace(/(\*\*|__|\*|_|~~)/g, '')
		.replace(/\s+/g, ' ')
		.trim();

	if (!plain) return '';
	if (plain.length <= maxChars) return plain;

	// Prefer whole sentences: take as many as fit, but never return nothing just
	// because the first sentence is long.
	const sentences = plain.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [plain];
	let out = '';
	for (const sentence of sentences) {
		const next = (out + sentence).trimEnd();
		if (out && next.length > maxChars) break;
		out = next;
		if (out.length >= maxChars) break;
	}
	out = out.trim();
	if (!out) out = plain;
	if (out.length > maxChars) out = `${out.slice(0, maxChars).trimEnd()}...`;
	return out;
}

/**
 * Whether the settling turn should be spoken by the fallback.
 *
 * - `active`: the `speakReplies` knob is ACTIVE (which already folds in the
 *   conversation-mode master gate; see isKnobActive). With spoken replies off,
 *   nothing is ever spoken, fallback included.
 * - `spokeThisTurn`: a `say` reply was already spoken for this turn. The agent's
 *   own spoken line always wins; the fallback exists only for its absence.
 * - `reply`: the final assistant text of the settled turn (may be empty, e.g. a
 *   turn that only ran tools).
 */
export function shouldSpeakFallback(opts: {
	active: boolean;
	spokeThisTurn: boolean;
	reply: string;
}): boolean {
	if (!opts.active) return false;
	if (opts.spokeThisTurn) return false;
	return spokenFallbackText(opts.reply).length > 0;
}
