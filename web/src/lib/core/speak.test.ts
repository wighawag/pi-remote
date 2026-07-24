import {describe, it, expect, vi, afterEach, beforeEach} from 'vitest';
import {
	extractSayText,
	speakUtterance,
	isTtsSpeaking,
	whenTtsIdle,
	resetTtsSettleSignal,
} from './speak.js';

// The `say` tool call carries a SHORT spoken-form reply in its args ({ text }).
// The web surfaces that call as a first-class "spoken:" card (mirroring
// attach_file) AND, when the `speakReplies` knob is active, speaks it via the
// browser SpeechSynthesis API. Both halves key off the SAME extracted text, so
// these pin the pure-logic seam ChatMessageList.svelte consumes — the text
// extraction that drives the card, and the feature-detected utterance that
// drives TTS — without standing up jsdom+svelte infra the repo deliberately
// omits.

describe('extractSayText', () => {
	it('returns the trimmed text from a say call args object', () => {
		expect(extractSayText({text: 'Done, the tests pass.'})).toBe(
			'Done, the tests pass.',
		);
		expect(extractSayText({text: '  padded  '})).toBe('padded');
	});

	it('is null for missing/blank/non-string text (nothing to speak or show)', () => {
		expect(extractSayText(null)).toBeNull();
		expect(extractSayText({})).toBeNull();
		expect(extractSayText({text: ''})).toBeNull();
		expect(extractSayText({text: '   '})).toBeNull();
		expect(extractSayText({text: 42 as unknown as string})).toBeNull();
	});
});

describe('speakUtterance', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	// A minimal fake of the SpeechSynthesis surface: records every utterance it is
	// asked to speak so the test can assert exactly-one and its lang/text.
	function fakeSynth() {
		const spoken: Array<{text: string; lang: string}> = [];
		const synth = {
			speak(u: {text: string; lang: string}) {
				spoken.push({text: u.text, lang: u.lang});
			},
		} as unknown as SpeechSynthesis;
		return {synth, spoken};
	}

	// The real SpeechSynthesisUtterance is not present in the node test env, so a
	// tiny constructor stand-in carrying text + lang is enough for the seam. It
	// also carries the onend/onerror hooks the TTS-settle signal wires up so a
	// test can fire them to simulate the utterance finishing.
	class FakeUtterance {
		text: string;
		lang = '';
		onend: (() => void) | null = null;
		onerror: (() => void) | null = null;
		constructor(text: string) {
			this.text = text;
		}
	}

	it('fires exactly one utterance carrying the text', () => {
		const {synth, spoken} = fakeSynth();
		const ok = speakUtterance('Hello there', undefined, {
			synth,
			Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
		});
		expect(ok).toBe(true);
		expect(spoken).toHaveLength(1);
		expect(spoken[0].text).toBe('Hello there');
	});

	it('sets the utterance lang from the provided locale where sensible', () => {
		const {synth, spoken} = fakeSynth();
		speakUtterance('Bonjour', 'fr-FR', {
			synth,
			Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
		});
		expect(spoken[0].lang).toBe('fr-FR');
	});

	it('leaves lang unset when no locale is given (browser default)', () => {
		const {synth, spoken} = fakeSynth();
		speakUtterance('Hi', '', {
			synth,
			Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
		});
		expect(spoken[0].lang).toBe('');
	});

	it('does not speak blank text and reports it did nothing', () => {
		const {synth, spoken} = fakeSynth();
		const ok = speakUtterance('   ', 'en-US', {
			synth,
			Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
		});
		expect(ok).toBe(false);
		expect(spoken).toHaveLength(0);
	});

	it('is a graceful no-op (no throw, returns false) when speechSynthesis is unavailable', () => {
		// Feature-absent: neither a synth nor an utterance constructor is present.
		expect(() =>
			speakUtterance('anything', 'en-US', {synth: null, Utterance: null}),
		).not.toThrow();
		expect(
			speakUtterance('anything', 'en-US', {synth: null, Utterance: null}),
		).toBe(false);
	});
});

// The hands-free mic-reopen loop must not re-open the mic while a `say` reply is
// still being spoken (else the reply is captured as microphone input). So
// core/speak.ts owns a minimal TTS-settle signal: it tracks outstanding
// utterances via onend/onerror and exposes isTtsSpeaking() / whenTtsIdle(). When
// no utterance was ever fired (speakReplies off) it reports idle IMMEDIATELY, so
// the re-open is never blocked.
describe('TTS-settle signal (isTtsSpeaking / whenTtsIdle)', () => {
	// The signal is module-global (one browser). The `speakUtterance` describe
	// above fires utterances whose onend never runs, so drain the count before each
	// test here to isolate them.
	beforeEach(() => {
		resetTtsSettleSignal();
	});
	afterEach(() => {
		resetTtsSettleSignal();
		vi.restoreAllMocks();
	});

	function fakeSynth() {
		const spoken: FakeUtterance[] = [];
		const synth = {
			speak(u: FakeUtterance) {
				spoken.push(u);
			},
		} as unknown as SpeechSynthesis;
		return {synth, spoken};
	}

	class FakeUtterance {
		text: string;
		lang = '';
		onend: (() => void) | null = null;
		onerror: (() => void) | null = null;
		constructor(text: string) {
			this.text = text;
		}
	}

	const Utterance = FakeUtterance as unknown as typeof SpeechSynthesisUtterance;

	it('reports idle immediately when no utterance was fired (speakReplies off)', async () => {
		expect(isTtsSpeaking()).toBe(false);
		// whenTtsIdle resolves right away, not blocking the re-open.
		await expect(whenTtsIdle()).resolves.toBeUndefined();
	});

	it('reports speaking while an utterance is outstanding, idle after it ends', async () => {
		const {synth, spoken} = fakeSynth();
		speakUtterance('Done, tests pass.', undefined, {synth, Utterance});
		expect(isTtsSpeaking()).toBe(true);

		let resolved = false;
		const idle = whenTtsIdle().then(() => {
			resolved = true;
		});
		// Still speaking, so the promise has not resolved yet.
		await Promise.resolve();
		expect(resolved).toBe(false);

		// Fire the utterance's onend: the browser signalling the spoken reply is done.
		spoken[0].onend?.();
		expect(isTtsSpeaking()).toBe(false);
		await idle;
		expect(resolved).toBe(true);
	});

	it('treats onerror as finished too (a failed utterance still settles)', async () => {
		const {synth, spoken} = fakeSynth();
		speakUtterance('Boom', undefined, {synth, Utterance});
		expect(isTtsSpeaking()).toBe(true);
		spoken[0].onerror?.();
		expect(isTtsSpeaking()).toBe(false);
		await expect(whenTtsIdle()).resolves.toBeUndefined();
	});

	it('waits for the LAST of several overlapping utterances to finish', async () => {
		const {synth, spoken} = fakeSynth();
		speakUtterance('one', undefined, {synth, Utterance});
		speakUtterance('two', undefined, {synth, Utterance});
		expect(isTtsSpeaking()).toBe(true);

		spoken[0].onend?.();
		// One still outstanding: not idle yet.
		expect(isTtsSpeaking()).toBe(true);

		spoken[1].onend?.();
		expect(isTtsSpeaking()).toBe(false);
		await expect(whenTtsIdle()).resolves.toBeUndefined();
	});
});
