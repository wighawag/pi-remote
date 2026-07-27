import {describe, it, expect, vi, afterEach, beforeEach} from 'vitest';
import {
	extractSayText,
	speakUtterance,
	isTtsSpeaking,
	whenTtsIdle,
	resetTtsSettleSignal,
	unlockTts,
	isTtsUnlocked,
	resetTtsUnlock,
	armTtsGestureUnlock,
	isTtsGestureUnlockArmed,
	resolveUtteranceLang,
	type GestureTarget,
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

// Mobile Chrome / iOS Safari / installed PWAs gate the FIRST
// speechSynthesis.speak() behind user activation: a speak() issued outside a
// real tap/click handler is silently DROPPED (no error, onend may never fire).
// The `say` reply speaks from a WebSocket-driven $effect, which has no gesture in
// its call stack, so the session must be primed from a gesture first (the
// Conversation Mode toggle tap). These pin that unlock seam: it primes exactly
// once, it is silent, it never throws, and -- critically -- the priming utterance
// is NOT tracked by the TTS-settle signal (else the hands-free mic-reopen loop
// would think TTS is speaking forever).
describe('TTS gesture-unlock (unlockTts)', () => {
	beforeEach(() => {
		resetTtsUnlock();
		resetTtsSettleSignal();
	});
	afterEach(() => {
		resetTtsUnlock();
		resetTtsSettleSignal();
		vi.restoreAllMocks();
	});

	class FakeUtterance {
		text: string;
		lang = '';
		volume = 1;
		onend: (() => void) | null = null;
		onerror: (() => void) | null = null;
		constructor(text: string) {
			this.text = text;
		}
	}

	const Utterance = FakeUtterance as unknown as typeof SpeechSynthesisUtterance;

	// A synth fake that records both the utterances spoken and the resume() kicks,
	// in call order, so a test can assert the queue is un-paused BEFORE speaking.
	function fakeSynth() {
		const spoken: FakeUtterance[] = [];
		const calls: string[] = [];
		const synth = {
			speak(u: FakeUtterance) {
				calls.push('speak');
				spoken.push(u);
			},
			resume() {
				calls.push('resume');
			},
		} as unknown as SpeechSynthesis;
		return {synth, spoken, calls};
	}

	it('primes speechSynthesis once and is idempotent', () => {
		const {synth, spoken} = fakeSynth();
		expect(isTtsUnlocked()).toBe(false);

		expect(unlockTts({synth, Utterance})).toBe(true);
		expect(isTtsUnlocked()).toBe(true);
		expect(spoken).toHaveLength(1);

		// Repeated gestures (toggling conversation mode off and on again) must not
		// re-prime: already unlocked for this session.
		expect(unlockTts({synth, Utterance})).toBe(false);
		expect(unlockTts({synth, Utterance})).toBe(false);
		expect(spoken).toHaveLength(1);
	});

	it('primes silently (the user hears no priming sound)', () => {
		const {synth, spoken} = fakeSynth();
		unlockTts({synth, Utterance});
		expect(spoken[0].volume).toBe(0);
	});

	it('primes with NON-blank text (mobile Chrome discards a blank utterance)', () => {
		// A whitespace-only utterance can be dropped before the speech pipeline runs,
		// which wastes the user activation it was issued under: the page then believes
		// it is primed while every later gesture-less reply is still silently dropped.
		const {synth, spoken} = fakeSynth();
		unlockTts({synth, Utterance});
		expect(spoken[0].text.trim()).not.toBe('');
		expect(spoken[0].volume).toBe(0);
	});

	it('kicks a paused queue (resume) before the priming utterance', () => {
		const {synth, calls} = fakeSynth();
		unlockTts({synth, Utterance});
		expect(calls).toEqual(['resume', 'speak']);
	});

	it('does NOT count the priming utterance in the TTS-settle signal', async () => {
		const {synth} = fakeSynth();
		unlockTts({synth, Utterance});
		// The priming utterance never fires onend on some browsers; if it were
		// tracked, the hands-free loop would wait forever.
		expect(isTtsSpeaking()).toBe(false);
		await expect(whenTtsIdle()).resolves.toBeUndefined();
	});

	it('is a no-op (no throw) when speechSynthesis is absent, and stays lockable', () => {
		expect(() => unlockTts({synth: null, Utterance: null})).not.toThrow();
		expect(unlockTts({synth: null, Utterance: null})).toBe(false);
		// Feature-absent must not latch "unlocked": a later gesture in a browser that
		// does have TTS still gets to prime.
		expect(isTtsUnlocked()).toBe(false);
		const {synth, spoken} = fakeSynth();
		expect(unlockTts({synth, Utterance})).toBe(true);
		expect(spoken).toHaveLength(1);
	});

	it('swallows a browser-side failure and stays lockable for the next gesture', () => {
		const throwing = {
			speak() {
				throw new Error('not allowed');
			},
			resume() {},
		} as unknown as SpeechSynthesis;
		expect(() => unlockTts({synth: throwing, Utterance})).not.toThrow();
		expect(unlockTts({synth: throwing, Utterance})).toBe(false);
		expect(isTtsUnlocked()).toBe(false);
		expect(isTtsSpeaking()).toBe(false);
	});

	it('works when the synth has no resume() (older/partial implementations)', () => {
		const spoken: FakeUtterance[] = [];
		const synth = {
			speak(u: FakeUtterance) {
				spoken.push(u);
			},
		} as unknown as SpeechSynthesis;
		expect(unlockTts({synth, Utterance})).toBe(true);
		expect(spoken).toHaveLength(1);
	});
});

// A real `say` reply speaks from a gesture-less $effect. Even once unlocked,
// mobile Chrome can leave the utterance queue PAUSED, which drops the utterance
// silently, so speakUtterance issues a defensive resume() kick before speaking.
describe('speakUtterance resume kick (real reply)', () => {
	beforeEach(() => {
		resetTtsSettleSignal();
	});
	afterEach(() => {
		resetTtsSettleSignal();
		vi.restoreAllMocks();
	});

	class FakeUtterance {
		text: string;
		lang = '';
		volume = 1;
		onend: (() => void) | null = null;
		onerror: (() => void) | null = null;
		constructor(text: string) {
			this.text = text;
		}
	}
	const Utterance = FakeUtterance as unknown as typeof SpeechSynthesisUtterance;

	it('resumes the queue before speaking a real reply', () => {
		const calls: string[] = [];
		const spoken: FakeUtterance[] = [];
		const synth = {
			speak(u: FakeUtterance) {
				calls.push('speak');
				spoken.push(u);
			},
			resume() {
				calls.push('resume');
			},
		} as unknown as SpeechSynthesis;

		expect(
			speakUtterance('Done, tests pass.', undefined, {synth, Utterance}),
		).toBe(true);
		expect(calls).toEqual(['resume', 'speak']);
		// The real reply IS tracked by the settle signal (unlike the priming one).
		expect(isTtsSpeaking()).toBe(true);
		spoken[0].onend?.();
		expect(isTtsSpeaking()).toBe(false);
	});

	it('does not resume (or throw) when there is nothing to speak', () => {
		const calls: string[] = [];
		const synth = {
			speak() {
				calls.push('speak');
			},
			resume() {
				calls.push('resume');
			},
		} as unknown as SpeechSynthesis;
		expect(speakUtterance('   ', undefined, {synth, Utterance})).toBe(false);
		expect(calls).toEqual([]);
		expect(isTtsSpeaking()).toBe(false);
	});
});

// A returning mobile user with conversation mode already persisted ON never taps
// the toggle, the mic or settings-save in that page load, so none of the explicit
// unlock call sites fire -- and every gesture-less `say` reply is dropped by the
// browser's user-activation gate. This net primes from the FIRST gesture, whatever
// it is (tapping the composer, a keypress, a scroll-stopping tap).
describe('TTS first-gesture unlock net (armTtsGestureUnlock)', () => {
	beforeEach(() => {
		resetTtsUnlock();
		resetTtsSettleSignal();
	});
	afterEach(() => {
		resetTtsUnlock();
		resetTtsSettleSignal();
		vi.restoreAllMocks();
	});

	class FakeUtterance {
		text: string;
		lang = '';
		volume = 1;
		onend: (() => void) | null = null;
		onerror: (() => void) | null = null;
		constructor(text: string) {
			this.text = text;
		}
	}
	const Utterance = FakeUtterance as unknown as typeof SpeechSynthesisUtterance;

	function fakeSynth() {
		const spoken: FakeUtterance[] = [];
		const synth = {
			speak(u: FakeUtterance) {
				spoken.push(u);
			},
			resume() {},
		} as unknown as SpeechSynthesis;
		return {synth, spoken};
	}

	/** A minimal EventTarget stand-in that records listeners and can fire them. */
	function fakeTarget() {
		const listeners = new Map<string, Set<() => void>>();
		const target: GestureTarget = {
			addEventListener(type, listener) {
				const set = listeners.get(type) ?? new Set();
				set.add(listener);
				listeners.set(type, set);
			},
			removeEventListener(type, listener) {
				listeners.get(type)?.delete(listener);
			},
		};
		return {
			target,
			types: () =>
				[...listeners.keys()].filter((t) => (listeners.get(t)?.size ?? 0) > 0),
			fire: (type: string) => {
				for (const listener of listeners.get(type) ?? []) listener();
			},
			count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
		};
	}

	it('primes on the first gesture and then removes itself', () => {
		const {synth, spoken} = fakeSynth();
		const t = fakeTarget();

		expect(armTtsGestureUnlock(t.target, {synth, Utterance})).toBe(true);
		expect(isTtsGestureUnlockArmed()).toBe(true);
		expect(isTtsUnlocked()).toBe(false);

		t.fire('pointerdown');
		expect(isTtsUnlocked()).toBe(true);
		expect(spoken).toHaveLength(1);
		// One gesture at most: every listener is gone once primed.
		expect(t.count()).toBe(0);
		expect(isTtsGestureUnlockArmed()).toBe(false);
	});

	it('listens for touch, mouse and keyboard gestures alike', () => {
		const {synth} = fakeSynth();
		const t = fakeTarget();
		armTtsGestureUnlock(t.target, {synth, Utterance});
		// Typing into the composer is a gesture too: a phone user who dictates
		// nothing and types everything must still get spoken replies.
		expect(t.types()).toContain('keydown');
		expect(t.types()).toContain('pointerdown');
		expect(t.types()).toContain('touchend');
	});

	it('stays armed when priming could not happen (no speech synthesis yet)', () => {
		const t = fakeTarget();
		armTtsGestureUnlock(t.target, {synth: null, Utterance: null});
		t.fire('pointerdown');
		expect(isTtsUnlocked()).toBe(false);
		expect(isTtsGestureUnlockArmed()).toBe(true);
		expect(t.count()).toBeGreaterThan(0);
	});

	it('is idempotent, and a no-op once TTS is already unlocked', () => {
		const {synth} = fakeSynth();
		const t = fakeTarget();
		expect(armTtsGestureUnlock(t.target, {synth, Utterance})).toBe(true);
		expect(armTtsGestureUnlock(t.target, {synth, Utterance})).toBe(false);
		const before = t.count();

		unlockTts({synth, Utterance});
		// The explicit unlock (toggle / mic / settings-save) disarms the net.
		expect(t.count()).toBe(0);
		expect(before).toBeGreaterThan(0);
		expect(armTtsGestureUnlock(t.target, {synth, Utterance})).toBe(false);
	});

	it('is a no-op without a document (SSR)', () => {
		const {synth} = fakeSynth();
		expect(armTtsGestureUnlock(null, {synth, Utterance})).toBe(false);
		expect(isTtsGestureUnlockArmed()).toBe(false);
	});
});

// Setting a `lang` the engine has no voice for is a known way to get SILENCE on
// mobile: the engine finds no match and says nothing at all.
describe('resolveUtteranceLang', () => {
	it('keeps the locale when a voice for that language exists', () => {
		expect(
			resolveUtteranceLang('en-GB', [{lang: 'en-US'}, {lang: 'fr-FR'}]),
		).toBe('en-GB');
	});

	it('drops the locale when the engine has no voice for that language', () => {
		expect(
			resolveUtteranceLang('fr-FR', [{lang: 'en-US'}, {lang: 'en-GB'}]),
		).toBe('');
	});

	it('keeps the locale when the voice list is unknown (not yet loaded)', () => {
		expect(resolveUtteranceLang('fr-FR', [])).toBe('fr-FR');
	});

	it('is empty for a missing/blank locale (browser default voice)', () => {
		expect(resolveUtteranceLang(undefined, [{lang: 'en-US'}])).toBe('');
		expect(resolveUtteranceLang('  ', [{lang: 'en-US'}])).toBe('');
	});
});

describe('speakUtterance voice-aware lang', () => {
	beforeEach(() => {
		resetTtsSettleSignal();
	});
	afterEach(() => {
		resetTtsSettleSignal();
	});

	class FakeUtterance {
		text: string;
		lang = '';
		volume = 1;
		onend: (() => void) | null = null;
		onerror: (() => void) | null = null;
		constructor(text: string) {
			this.text = text;
		}
	}
	const Utterance = FakeUtterance as unknown as typeof SpeechSynthesisUtterance;

	function synthWithVoices(voices: {lang: string}[] | null) {
		const spoken: FakeUtterance[] = [];
		const synth = {
			speak(u: FakeUtterance) {
				spoken.push(u);
			},
			resume() {},
			getVoices: voices ? () => voices : undefined,
		} as unknown as SpeechSynthesis;
		return {synth, spoken};
	}

	it('drops an unsupported locale rather than speaking into the void', () => {
		const {synth, spoken} = synthWithVoices([{lang: 'en-US'}]);
		expect(speakUtterance('Bonjour.', 'fr-FR', {synth, Utterance})).toBe(true);
		expect(spoken[0].lang).toBe('');
	});

	it('keeps a supported locale, and any locale when voices are unknown', () => {
		const supported = synthWithVoices([{lang: 'fr-FR'}]);
		speakUtterance('Bonjour.', 'fr-FR', {synth: supported.synth, Utterance});
		expect(supported.spoken[0].lang).toBe('fr-FR');

		const unknown = synthWithVoices(null);
		speakUtterance('Bonjour.', 'fr-FR', {synth: unknown.synth, Utterance});
		expect(unknown.spoken[0].lang).toBe('fr-FR');
	});
});
