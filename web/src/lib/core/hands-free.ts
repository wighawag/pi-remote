// The hands-free loop (`micReopensAfterReply` knob) lets the user carry on a
// spoken conversation without tapping: after the agent settles (the isStreaming
// true->false edge the waiting-for-human beep already uses) AND any in-flight
// TTS has finished, the mic is re-opened for another turn.
//
// This module is the pure decision seam the settle-edge driver in
// ChatInput.svelte consumes (mirror of core/collapse-reply.ts and
// core/compose-send.ts): given whether the knob is active and which speech
// engine is in use, WHAT should happen when a reply settles. The gating of the
// knob itself (conversation mode ON and micReopensAfterReply ON) lives upstream
// in core/conversation-mode.ts's isKnobActive and is folded into `active` here;
// the wait-for-TTS-to-finish coordination lives in core/speak.ts's TTS-settle
// signal. Keeping the decision pure makes the engine-scope rule unit-testable
// without standing up jsdom + svelte the repo deliberately omits.

/** The speech engine SpeechButton is currently using. */
export type SpeechEngine = 'browser' | 'cloud';

/**
 * What the settle-edge driver should do when a reply settles.
 *
 * - `reopen-mic`: auto-restart streaming speech recognition (browser engine).
 * - `refocus-composer`: just re-focus the textarea, NO auto-record (cloud
 *   engine fallback).
 * - `none`: do nothing (knob inactive).
 */
export type MicReopenAction = 'reopen-mic' | 'refocus-composer' | 'none';

/**
 * Decide what to do when the agent's reply settles.
 *
 * Open Question 3 (resolved): auto mic-reopen is BROWSER-engine ONLY, because
 * the streaming speech-recognition engine restarts recognition cleanly. The
 * CLOUD engine is an explicit hold-to-talk / tap-to-toggle gesture
 * (getUserMedia + manual WAV encode) with no natural auto-record gesture, so
 * auto-recording there would surprise the user; instead it FALLS BACK to just
 * re-focusing the composer (no auto-record). When the knob is inactive
 * (conversation mode off, or micReopensAfterReply off) NOTHING re-opens or
 * auto-focuses, so the default typing-first experience is unchanged.
 *
 * @param active whether the `micReopensAfterReply` knob is active (already folds
 *   in the conversation-mode master gate; see isKnobActive).
 * @param engine the speech engine currently selected in SpeechButton.
 */
export function decideMicReopen(opts: {
	active: boolean;
	engine: SpeechEngine;
}): MicReopenAction {
	if (!opts.active) return 'none';
	return opts.engine === 'browser' ? 'reopen-mic' : 'refocus-composer';
}
