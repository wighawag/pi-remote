import {describe, it, expect} from 'vitest';
import {
	LONG_REPLY_CHAR_THRESHOLD,
	isLongReply,
	shouldCollapseReply,
} from './collapse-reply.js';

// Conversation mode's `collapseLongReplies` knob de-emphasises LONG written
// assistant replies so the short spoken summary is the focus and the transcript
// stays glanceable. This is a DISPLAY concern only: the full reply is NEVER
// deleted or truncated destructively -- it is merely collapsed and always
// remains expandable/readable. These pin the pure decision seam
// ChatMessageList.svelte consumes (whether a given reply renders collapsed),
// without standing up jsdom+svelte infra the repo deliberately omits.

// A reply comfortably over the threshold, and one comfortably under it.
const longReply = 'x'.repeat(LONG_REPLY_CHAR_THRESHOLD + 50);
const shortReply = 'Done, the tests pass.';

describe('isLongReply', () => {
	it('is true only past the char threshold', () => {
		expect(isLongReply(longReply)).toBe(true);
		expect(isLongReply(shortReply)).toBe(false);
		expect(isLongReply('x'.repeat(LONG_REPLY_CHAR_THRESHOLD))).toBe(false);
		expect(isLongReply('x'.repeat(LONG_REPLY_CHAR_THRESHOLD + 1))).toBe(true);
	});

	it('treats missing/blank content as not long', () => {
		expect(isLongReply('')).toBe(false);
		expect(isLongReply(undefined)).toBe(false);
	});
});

describe('shouldCollapseReply', () => {
	it('collapses a long reply when the knob is active and it is not expanded', () => {
		expect(
			shouldCollapseReply({active: true, expanded: false, content: longReply}),
		).toBe(true);
	});

	it('never collapses when the knob is inactive (mode off / knob off) -- renders exactly as today', () => {
		// The whole gating decision lives upstream in isKnobActive; here `active`
		// already folds in "conversation mode on AND collapseLongReplies on".
		expect(
			shouldCollapseReply({active: false, expanded: false, content: longReply}),
		).toBe(false);
	});

	it('never collapses a short reply, even with the knob active', () => {
		expect(
			shouldCollapseReply({active: true, expanded: false, content: shortReply}),
		).toBe(false);
	});

	it('does not collapse once the user has expanded it -- the full text is always reachable', () => {
		// Expanding is the reader's escape hatch: a long reply the user opened
		// renders in full, never re-collapsed behind their back.
		expect(
			shouldCollapseReply({active: true, expanded: true, content: longReply}),
		).toBe(false);
	});
});
