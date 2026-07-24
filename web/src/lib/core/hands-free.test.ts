import {describe, it, expect} from 'vitest';
import {decideMicReopen} from './hands-free.js';

// The hands-free loop (`micReopensAfterReply` knob) re-opens the mic after the
// agent settles (the isStreaming true->false edge the waiting-for-human beep
// already uses) AND any in-flight TTS has finished. Open Question 3 resolved the
// engine scope: auto mic-reopen is BROWSER-engine only (streaming recognition
// restarts cleanly); the CLOUD engine (explicit hold-to-talk / tap-to-toggle)
// has no natural auto-record gesture, so it FALLS BACK to re-focusing the
// composer -- no auto-record. When the knob is inactive (conversation mode off,
// or the knob off) NOTHING happens. This module is the pure decision seam the
// settle-edge driver in ChatInput.svelte consumes; the gating of the knob itself
// (conversation mode on AND micReopensAfterReply on) lives upstream in
// core/conversation-mode.ts's isKnobActive and is folded into `active` here.

describe('decideMicReopen', () => {
	it('re-opens the mic on the browser engine when the knob is active', () => {
		expect(decideMicReopen({active: true, engine: 'browser'})).toBe(
			'reopen-mic',
		);
	});

	it('re-focuses the composer (no auto-record) on the cloud engine when active', () => {
		expect(decideMicReopen({active: true, engine: 'cloud'})).toBe(
			'refocus-composer',
		);
	});

	it('does nothing when the knob is inactive, regardless of engine', () => {
		expect(decideMicReopen({active: false, engine: 'browser'})).toBe('none');
		expect(decideMicReopen({active: false, engine: 'cloud'})).toBe('none');
	});
});
