// The hands-free loop (`micReopensAfterReply` knob) lets the user carry on a
// spoken conversation without tapping: after the agent settles (the isStreaming
// true->false edge the waiting-for-human beep already uses) AND any in-flight
// TTS has finished, the mic is re-opened for another turn.
//
// This module is the pure decision seam the settle-edge driver in
// ChatInput.svelte consumes (mirror of core/collapse-reply.ts and
// core/compose-send.ts): given whether the knob is active, WHAT should happen
// when a reply settles, and (for the cloud engine) WHEN an auto-opened
// recording should stop again. The gating of the knob itself (conversation mode
// ON and micReopensAfterReply ON) lives upstream in core/conversation-mode.ts's
// isKnobActive and is folded into `active` here; the wait-for-TTS-to-finish
// coordination lives in core/speak.ts's TTS-settle signal. Keeping the decisions
// pure makes them unit-testable without standing up jsdom + svelte the repo
// deliberately omits.

/** The speech engine SpeechButton is currently using. */
export type SpeechEngine = 'browser' | 'cloud';

/**
 * What the settle-edge driver should do when a reply settles.
 *
 * - `reopen-mic`: start recording again, as a manual tap would.
 * - `none`: do nothing (knob inactive).
 */
export type MicReopenAction = 'reopen-mic' | 'none';

/**
 * Decide what to do when the agent's reply settles.
 *
 * BOTH engines auto-record. An earlier revision re-opened the mic only on the
 * BROWSER engine and merely re-focused the composer on the CLOUD engine, on the
 * grounds that auto-recording without a gesture would surprise the user. That
 * had it backwards: THE CONFIRMATION IS IN THE CONFIG, NOT IN THE CONVERSATION.
 * A user who turned `micReopensAfterReply` on has already said "re-open my mic
 * after each reply"; silently refusing to do it on one engine makes the knob
 * lie, and leaves a phone user (who is the most likely to be on the cloud
 * engine) tapping the mic every single turn, which is exactly the hands-free
 * loop this knob exists to remove.
 *
 * What the cloud engine genuinely needs is not consent but a STOP condition: it
 * records until told to stop, with no endpointing of its own (the browser engine
 * ends its own utterance). That is what createAutoStopDetector below provides,
 * so an auto-opened cloud recording ends on silence and can never run away.
 *
 * @param active whether the `micReopensAfterReply` knob is active (already folds
 *   in the conversation-mode master gate; see isKnobActive).
 * @param engine the speech engine currently selected in SpeechButton, kept for
 *   call-site clarity and future per-engine rules.
 */
export function decideMicReopen(opts: {
	active: boolean;
	engine: SpeechEngine;
}): MicReopenAction {
	return opts.active ? 'reopen-mic' : 'none';
}

/** What an auto-opened recording should do after the latest audio frame. */
export type AutoStopDecision = 'keep-recording' | 'stop-silence' | 'stop-max';

export interface AutoStopDetector {
	/**
	 * Feed one audio frame.
	 *
	 * @param level the frame's loudness (RMS amplitude, 0..1)
	 * @param frameMs how much audio time that frame represents
	 */
	push(level: number, frameMs: number): AutoStopDecision;
}

/** Defaults tuned for "the human finished their sentence", not for hard silence. */
export const AUTO_STOP_DEFAULTS = {
	/** Above this RMS a frame counts as speech (a quiet room sits well below). */
	speechLevel: 0.015,
	/** Stop after this much continuous silence FOLLOWING some speech. */
	silenceMs: 2000,
	/** Stop after this much silence when the user never said anything at all. */
	leadingSilenceMs: 6000,
	/** Hard ceiling on one auto-opened recording, whatever the audio does. */
	maxMs: 60_000,
};

/**
 * A stop-condition for a recording the HANDS-FREE loop opened (never for one the
 * user opened by tapping: there, the user's next tap is the stop, and taking
 * that away would be the surprising behaviour).
 *
 * Three ways to end, in priority order:
 * - `stop-max`: the hard ceiling, so a hot mic in a noisy room cannot record
 *   (and upload, and pay for) forever;
 * - `stop-silence` after speech: the user said something and has stopped, which
 *   is the normal end of a hands-free turn;
 * - `stop-silence` before any speech: the mic re-opened, nobody spoke, so the
 *   loop gives up rather than sending a recording of the room.
 *
 * Pure and stateful-but-local: no timers, no browser APIs. The caller feeds it
 * frames it already has (SpeechButton's ScriptProcessor hands over PCM anyway),
 * which also means the detector is driven by real captured audio rather than by
 * a wall clock that keeps running when the tab is throttled.
 */
export function createAutoStopDetector(
	opts: Partial<typeof AUTO_STOP_DEFAULTS> = {},
): AutoStopDetector {
	const {speechLevel, silenceMs, leadingSilenceMs, maxMs} = {
		...AUTO_STOP_DEFAULTS,
		...opts,
	};
	let elapsedMs = 0;
	let silentMs = 0;
	let heardSpeech = false;
	// Once it has decided to stop, the decision STICKS: audio frames can still
	// arrive after the caller asks to stop (the processor is torn down
	// asynchronously), and a detector that flipped back to 'keep-recording' would
	// read as "carry on" to anything inspecting it later.
	let stopped: AutoStopDecision | null = null;

	return {
		push(level: number, frameMs: number): AutoStopDecision {
			if (stopped) return stopped;
			elapsedMs += frameMs;

			if (level >= speechLevel) {
				heardSpeech = true;
				silentMs = 0;
			} else {
				silentMs += frameMs;
			}

			if (elapsedMs >= maxMs) {
				stopped = 'stop-max';
				return stopped;
			}
			const limit = heardSpeech ? silenceMs : leadingSilenceMs;
			if (silentMs >= limit) {
				stopped = 'stop-silence';
				return stopped;
			}
			return 'keep-recording';
		},
	};
}

/** RMS amplitude (0..1) of a frame of mono float samples. */
export function frameLevel(samples: ArrayLike<number>): number {
	const length = samples.length;
	if (!length) return 0;
	let sum = 0;
	for (let i = 0; i < length; i++) {
		const sample = samples[i];
		sum += sample * sample;
	}
	return Math.sqrt(sum / length);
}
