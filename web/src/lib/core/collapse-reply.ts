// Conversation mode's `collapseLongReplies` knob de-emphasises LONG written
// assistant replies so the short spoken summary (the `say` card) is the focus
// and the transcript stays glanceable during a hands-busy spoken exchange.
//
// This is a DISPLAY concern ONLY: the full written reply is NEVER deleted,
// hidden, or destructively truncated. A collapsed reply is merely clamped/
// de-emphasised and ALWAYS remains expandable and fully readable (the reader's
// escape hatch). When the knob is inactive (conversation mode off, or the knob
// off), replies render exactly as today. The underlying transcript/message
// content is untouched either way.
//
// This module is the pure decision seam ChatMessageList.svelte consumes (mirror
// of core/speak.ts for the `say` card): "should THIS reply render collapsed
// right now?" The gating of the knob itself (conversation mode on AND
// collapseLongReplies on) lives upstream in core/conversation-mode.ts's
// isKnobActive; the `active` argument here already folds that in.

/**
 * How many characters make a written reply "long" enough to collapse. Below
 * this a reply is short enough to leave alone (collapsing it would be pure
 * noise). Tuned to spare typical short answers while catching the long,
 * code-heavy replies conversation mode is meant to de-emphasise.
 *
 * DECISION (recorded here, the natural choice site): the threshold is a fixed
 * char count, NOT a new user-configurable knob. Rationale: the task scope is a
 * boolean knob (`collapseLongReplies`) plus the collapse behaviour; adding a
 * "how long is long" setting would be a new user-visible config surface the
 * conversation-mode knobs registry does not define, so it is deliberately kept
 * an internal display heuristic. Alternative considered: derive from a line/
 * viewport-height measure. Rejected for v1 as it needs DOM measurement (harder
 * to unit-test at this pure seam) for no clear user benefit over a char count.
 * Touches nothing outside this module; a future task can promote it to a knob
 * without changing shouldCollapseReply's shape.
 */
export const LONG_REPLY_CHAR_THRESHOLD = 600;

/**
 * Whether an assistant reply's written content is long enough to be a collapse
 * candidate. Missing/blank content is never long.
 */
export function isLongReply(content: string | undefined | null): boolean {
	if (!content) return false;
	return content.length > LONG_REPLY_CHAR_THRESHOLD;
}

/**
 * Whether a given assistant reply should render COLLAPSED right now.
 *
 * True only when all of:
 * - `active`: the `collapseLongReplies` knob is active (which, being a gated
 *   conversation knob, already requires conversation mode on -- see
 *   isKnobActive). When false, this is always false: replies render exactly as
 *   today, no collapse.
 * - `content` is long (past LONG_REPLY_CHAR_THRESHOLD). Short replies are never
 *   collapsed.
 * - `expanded` is false: the user has not opened this reply. Expanding is the
 *   escape hatch -- an opened reply renders in FULL and is never re-collapsed
 *   behind the reader's back. The full text is therefore always reachable.
 *
 * Collapse is a display state; it never removes or truncates the stored reply.
 */
export function shouldCollapseReply(opts: {
	active: boolean;
	expanded: boolean;
	content: string | undefined | null;
}): boolean {
	if (!opts.active) return false;
	if (opts.expanded) return false;
	return isLongReply(opts.content);
}
