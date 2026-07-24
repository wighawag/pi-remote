import {describe, it, expect, vi, afterEach} from 'vitest';
import {extractSayText, speakUtterance} from './speak.js';

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
	// tiny constructor stand-in carrying text + lang is enough for the seam.
	class FakeUtterance {
		text: string;
		lang = '';
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
