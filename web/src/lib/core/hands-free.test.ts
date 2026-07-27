import {describe, it, expect} from 'vitest';
import {
	AUTO_STOP_DEFAULTS,
	createAutoStopDetector,
	decideMicReopen,
	frameLevel,
} from './hands-free.js';

// The hands-free loop (`micReopensAfterReply` knob) re-opens the mic after the
// agent settles (the isStreaming true->false edge the waiting-for-human beep
// already uses) AND any in-flight TTS has finished. The engine scope was
// REVISED: auto-record now happens on BOTH engines, because the user's
// confirmation lives in the CONFIG (the knob they turned on), not in each
// conversation. What the cloud engine needs is a STOP condition, not a refusal
// to start -- it has no endpointing of its own -- and that is the auto-stop
// detector. When the knob is inactive (conversation mode off, or the knob off)
// NOTHING happens.

describe('decideMicReopen', () => {
	it('re-opens the mic on the browser engine when the knob is active', () => {
		expect(decideMicReopen({active: true, engine: 'browser'})).toBe(
			'reopen-mic',
		);
	});

	it('re-opens the mic on the CLOUD engine too (consent lives in the config)', () => {
		// Previously this returned 'refocus-composer', which made the knob lie and
		// left phone users tapping the mic every turn.
		expect(decideMicReopen({active: true, engine: 'cloud'})).toBe('reopen-mic');
	});

	it('does nothing when the knob is inactive, regardless of engine', () => {
		expect(decideMicReopen({active: false, engine: 'browser'})).toBe('none');
		expect(decideMicReopen({active: false, engine: 'cloud'})).toBe('none');
	});
});

describe('frameLevel', () => {
	it('is 0 for silence (and for an empty frame)', () => {
		expect(frameLevel(new Float32Array(128))).toBe(0);
		expect(frameLevel(new Float32Array(0))).toBe(0);
	});

	it('rises with amplitude, independent of sign', () => {
		const quiet = frameLevel(new Float32Array([0.01, -0.01, 0.01, -0.01]));
		const loud = frameLevel(new Float32Array([0.5, -0.5, 0.5, -0.5]));
		expect(quiet).toBeCloseTo(0.01, 5);
		expect(loud).toBeCloseTo(0.5, 5);
	});
});

describe('createAutoStopDetector', () => {
	const FRAME = 100; // ms per fed frame
	const speech = AUTO_STOP_DEFAULTS.speechLevel * 2;
	const silence = 0;

	/** Feed `count` frames at `level`, returning the LAST decision. */
	function feed(
		detector: ReturnType<typeof createAutoStopDetector>,
		level: number,
		count: number,
	) {
		let decision = 'keep-recording' as ReturnType<typeof detector.push>;
		for (let i = 0; i < count; i++) decision = detector.push(level, FRAME);
		return decision;
	}

	it('keeps recording while the user is speaking', () => {
		const detector = createAutoStopDetector();
		expect(feed(detector, speech, 100)).toBe('keep-recording');
	});

	it('stops after a pause once the user HAS spoken', () => {
		const detector = createAutoStopDetector();
		feed(detector, speech, 5);
		const almost = feed(
			detector,
			silence,
			AUTO_STOP_DEFAULTS.silenceMs / FRAME - 1,
		);
		expect(almost).toBe('keep-recording');
		expect(detector.push(silence, FRAME)).toBe('stop-silence');
	});

	it('does not stop on brief pauses between words', () => {
		const detector = createAutoStopDetector();
		feed(detector, speech, 3);
		feed(detector, silence, AUTO_STOP_DEFAULTS.silenceMs / FRAME - 2);
		// A new word resets the silence run.
		feed(detector, speech, 2);
		expect(
			feed(detector, silence, AUTO_STOP_DEFAULTS.silenceMs / FRAME - 1),
		).toBe('keep-recording');
	});

	it('gives up (more patiently) when nobody ever speaks', () => {
		const detector = createAutoStopDetector();
		// The post-speech timeout would have fired by now; leading silence is longer.
		expect(feed(detector, silence, AUTO_STOP_DEFAULTS.silenceMs / FRAME)).toBe(
			'keep-recording',
		);
		expect(
			feed(detector, silence, AUTO_STOP_DEFAULTS.leadingSilenceMs / FRAME),
		).toBe('stop-silence');
	});

	it('enforces a hard ceiling so a hot mic cannot record forever', () => {
		// Continuous speech-level noise: the silence rule can never fire.
		const detector = createAutoStopDetector();
		expect(feed(detector, speech, AUTO_STOP_DEFAULTS.maxMs / FRAME)).toBe(
			'stop-max',
		);
	});

	it('decides once: the stop decision STICKS for late frames', () => {
		// Audio keeps arriving while the processor is torn down; the detector must
		// not flip back to "carry on".
		const detector = createAutoStopDetector({silenceMs: 200});
		feed(detector, speech, 1);
		expect(feed(detector, silence, 2)).toBe('stop-silence');
		expect(detector.push(speech, FRAME)).toBe('stop-silence');
	});

	it('honours caller-provided thresholds', () => {
		const detector = createAutoStopDetector({silenceMs: 300, speechLevel: 0.5});
		// 0.2 counts as SILENCE under this threshold, so nothing was ever "spoken".
		expect(feed(detector, 0.2, 3)).toBe('keep-recording');
		const loud = createAutoStopDetector({silenceMs: 300, speechLevel: 0.1});
		feed(loud, 0.2, 1);
		expect(feed(loud, 0, 3)).toBe('stop-silence');
	});
});
