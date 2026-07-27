// Browser text-to-speech for the `say` tool's spoken-form reply, mirroring the
// core/beep.ts pattern: a small, framework-agnostic helper that FEATURE-DETECTS
// its browser API and degrades to a silent no-op (never a throw) when it is
// unavailable, so it is safe to call from anywhere and unit-testable without a
// real browser.
//
// The `say` affordance is driven entirely by the tool CALL over the already
// streamed tool_start/tool_end (no new WS message type, no new chat role). The
// short spoken text comes ONLY from the agent's explicit `say({ text })` call —
// it is NEVER a client-side summary of the full written reply. The full written
// reply always stays in the transcript; the spoken layer is additive.

/**
 * Pull the spoken text out of a `say` tool call's parsed args object.
 *
 * Returns the trimmed `text`, or null when there is nothing to speak/show
 * (missing, blank, or non-string). Both the first-class "spoken:" card render
 * and the TTS utterance key off this SAME extracted text, so divergence between
 * what is shown and what is spoken is impossible.
 */
export function extractSayText(
	argsObj: Record<string, unknown> | null | undefined,
): string | null {
	if (!argsObj) return null;
	const raw = argsObj.text;
	if (typeof raw !== 'string') return null;
	const text = raw.trim();
	return text ? text : null;
}

// The browser TTS surface this module needs, injectable so tests can supply a
// fake without a real SpeechSynthesis (which the node test env lacks). In the
// browser these default to window.speechSynthesis + SpeechSynthesisUtterance.
export interface SpeechDeps {
	synth: SpeechSynthesis | null;
	Utterance: typeof SpeechSynthesisUtterance | null;
}

// --- TTS-settle signal ------------------------------------------------------
// The hands-free mic-reopen loop (see core/hands-free.ts) must NOT re-open the
// mic while a `say` reply is still being spoken, or the spoken reply would be
// captured as microphone input. `speakUtterance` is otherwise fire-and-forget,
// so this module owns a minimal settle signal: it tracks how many utterances
// are currently outstanding (incremented on speak, decremented on the
// utterance's onend/onerror) and lets a caller ask "is TTS speaking right now?"
// or await "resolve once TTS is idle". When no utterance was ever fired
// (speakReplies off) the count is 0, so it reports idle IMMEDIATELY and never
// blocks the re-open. Deliberately additive: speakUtterance's existing callers
// see no behaviour change.
let outstandingUtterances = 0;
let idleWaiters: Array<() => void> = [];

function settleOneUtterance(): void {
	if (outstandingUtterances > 0) outstandingUtterances--;
	if (outstandingUtterances === 0 && idleWaiters.length > 0) {
		const waiters = idleWaiters;
		idleWaiters = [];
		for (const resolve of waiters) resolve();
	}
}

/**
 * Whether the browser is currently speaking a `say` reply (one or more
 * utterances are outstanding). Reports false when nothing was ever spoken
 * (speakReplies off) so the hands-free loop is not blocked.
 */
export function isTtsSpeaking(): boolean {
	return outstandingUtterances > 0;
}

/**
 * Resolve once no TTS utterance is outstanding. Resolves IMMEDIATELY when TTS is
 * already idle (including when no utterance was ever fired), otherwise resolves
 * when the last outstanding utterance finishes (onend) or fails (onerror). The
 * hands-free loop awaits this before re-opening the mic so the spoken reply is
 * never captured as input.
 */
export function whenTtsIdle(): Promise<void> {
	if (outstandingUtterances === 0) return Promise.resolve();
	return new Promise((resolve) => {
		idleWaiters.push(resolve);
	});
}

/**
 * Force the TTS-settle signal back to idle, resolving any pending whenTtsIdle()
 * waiters. Use when outstanding utterances can no longer be trusted to fire
 * their onend (e.g. the page called speechSynthesis.cancel() on session
 * teardown, which drops queued utterances without an onend for each), and in
 * test teardown so the module-global count does not leak between tests.
 */
export function resetTtsSettleSignal(): void {
	outstandingUtterances = 0;
	const waiters = idleWaiters;
	idleWaiters = [];
	for (const resolve of waiters) resolve();
}

// --- Gesture unlock --------------------------------------------------------
// Mobile Chrome, iOS Safari and installed PWA webviews gate the FIRST
// speechSynthesis.speak() of a page behind USER ACTIVATION: a speak() issued
// outside a real tap/click handler is silently DROPPED (no error thrown, and
// onend may never fire). A `say` reply is spoken from a WebSocket-driven $effect
// in the chat list, so there is no gesture in its call stack -- which is exactly
// why the spoken reply worked on desktop but never fired on mobile.
//
// The remedy is the standard one-time gesture unlock (the same shape as
// core/beep.ts resuming a suspended AudioContext on user interaction): the first
// time the user makes a gesture that means "I want spoken replies" -- turning
// Conversation Mode ON, or tapping the mic -- we prime speechSynthesis from
// INSIDE that handler, and the browser then permits the later gesture-less
// utterances for the rest of the session.
let ttsUnlocked = false;
// Whether the document-wide "prime on the first gesture, whatever it is" net is
// currently armed (see armTtsGestureUnlock).
let gestureUnlockArmed = false;
let disarmGestureUnlock: (() => void) | null = null;

// Best-effort "un-pause the queue" kick. Mobile Chrome can leave the
// speechSynthesis queue in a paused state, which swallows subsequent utterances
// even after the session is unlocked. resume() on an unpaused queue is a no-op,
// so this is safe to issue before every speak; guarded for implementations that
// lack it (and swallow-all, like the rest of the module).
function resumeQueue(synth: SpeechSynthesis): void {
	try {
		if (typeof synth.resume === 'function') synth.resume();
	} catch {
		// A spoken reply is a nicety: never surface a browser-side failure.
	}
}

// Inaudible (volume 0) but NOT blank: mobile Chrome drops whitespace-only
// utterances outright, so a blank prime can fail to consume the user activation
// it was issued under. See unlockTts.
const PRIMING_TEXT = '.';

/**
 * Ask the engine for its voices, tolerating implementations that lack/throw on
 * getVoices(). Returns [] when the list is not (yet) known, which callers must
 * treat as "no information", never as "no voices exist".
 */
function loadVoices(synth: SpeechSynthesis): SpeechSynthesisVoice[] {
	try {
		if (typeof synth.getVoices !== 'function') return [];
		return synth.getVoices() ?? [];
	} catch {
		return [];
	}
}

/**
 * The `lang` to set on an utterance, or '' to leave the browser default alone.
 *
 * Setting a lang the engine has NO voice for is a known way to get silence on
 * mobile: the engine finds no match and simply says nothing. So the configured
 * speech locale is applied only when the voice list actually offers that language
 * (matched on the primary subtag, so `en-GB` is served by an `en-US` voice). When
 * the list is empty -- unknown, e.g. voices not loaded yet, or an engine without
 * getVoices() -- we have no information, so the locale is applied as before.
 *
 * Exported for unit testing; production callers go through speakUtterance.
 */
export function resolveUtteranceLang(
	lang: string | undefined,
	voices: readonly {lang?: string}[],
): string {
	const wanted = (lang ?? '').trim();
	if (!wanted) return '';
	if (voices.length === 0) return wanted;
	const primary = wanted.toLowerCase().split(/[-_]/)[0];
	const supported = voices.some(
		(voice) => (voice.lang ?? '').toLowerCase().split(/[-_]/)[0] === primary,
	);
	return supported ? wanted : '';
}

/**
 * Prime the browser's speech synthesis from INSIDE a user gesture so later
 * gesture-less `say` replies are actually spoken on mobile Chrome / iOS Safari /
 * installed PWAs. Idempotent: returns true only for the call that actually
 * primed, false when already unlocked or when it could not prime.
 *
 * MUST be called synchronously from a real tap/click handler (calling it from a
 * timer or a WebSocket effect does nothing useful -- there is no user activation
 * to consume). Its two production call sites are both real gestures that mean "I
 * want a spoken exchange":
 * - the Conversation Mode toggle handler in ChatMessageList.svelte (the user
 *   opting into spoken replies), and
 * - the mic-button pointerdown in speech/SpeechButton.svelte, which additionally
 *   covers a RETURNING user whose conversation mode was already persisted ON and
 *   who therefore never taps the toggle.
 * The gesture-less hands-free re-open path (startRecordingProgrammatically) does
 * NOT unlock, since there is no user activation there.
 *
 * The priming utterance is SILENT (volume 0) so the user hears nothing, but its
 * text is deliberately NOT blank: mobile Chrome DISCARDS a whitespace-only
 * utterance without ever running the speech pipeline, so an empty prime can be
 * dropped without consuming the user activation it was issued under -- priming
 * that never primes, which is the mobile silence this is meant to fix. A single
 * period at volume 0 is inaudible and still exercises the pipeline.
 *
 * It is deliberately NOT tracked by the TTS-settle signal: some browsers never
 * fire onend for a priming utterance, which would wedge isTtsSpeaking() at true
 * forever and stop the hands-free loop from ever re-opening the mic. Keeping it
 * off the tracked path means isTtsSpeaking() / whenTtsIdle() keep reporting ONLY
 * real `say` replies.
 *
 * We do NOT call speechSynthesis.cancel() around the priming: cancel drops
 * queued utterances without firing their onend, which would leak the settle
 * count for a real reply that happens to be speaking when the user re-toggles.
 *
 * Feature-detected + swallow-all: a no-op (never a throw) when speechSynthesis is
 * absent, and in that case the session stays lockable so a later gesture in a
 * capable browser can still prime.
 *
 * `deps` is injectable for testing; production callers omit it.
 */
export function unlockTts(deps: SpeechDeps = browserSpeechDeps()): boolean {
	if (ttsUnlocked) return false;

	const {synth, Utterance} = deps;
	if (!synth || !Utterance) return false;

	try {
		resumeQueue(synth);
		// Nudge the voice list into loading while we are here: some engines only
		// populate getVoices() lazily, and a first utterance issued before any voice
		// exists can be dropped.
		loadVoices(synth);
		const priming = new Utterance(PRIMING_TEXT);
		priming.volume = 0;
		// No onend/onerror wiring and no outstandingUtterances++ on purpose: this
		// utterance must stay invisible to the settle signal.
		synth.speak(priming);
		ttsUnlocked = true;
		disarmGestureUnlock?.();
		return true;
	} catch {
		// Could not prime (e.g. the browser refused outside an activation window):
		// stay locked so the next gesture gets another go.
		return false;
	}
}

/**
 * Whether TTS has been primed from a user gesture in this session. Diagnostic /
 * test-facing; callers do not need to check it before speaking (an un-primed
 * speak simply degrades to silence, as it does today).
 */
export function isTtsUnlocked(): boolean {
	return ttsUnlocked;
}

/**
 * Forget that TTS was unlocked. For test isolation (the flag is module-global,
 * one per browser page); production code never needs this.
 */
export function resetTtsUnlock(): void {
	ttsUnlocked = false;
	disarmGestureUnlock?.();
}

/** The minimal event-target surface armTtsGestureUnlock needs (injectable for tests). */
export interface GestureTarget {
	addEventListener(
		type: string,
		listener: () => void,
		options?: {capture?: boolean; passive?: boolean},
	): void;
	removeEventListener(
		type: string,
		listener: () => void,
		options?: {capture?: boolean},
	): void;
}

// Any of these means "a human is driving this page right now", which is all the
// browser asks for before it will let the page speak.
const GESTURE_EVENTS = ['pointerdown', 'touchend', 'mousedown', 'keydown'];

/**
 * Arm a one-shot, document-wide net that primes TTS from the user's NEXT gesture,
 * whatever that gesture is.
 *
 * WHY, on top of the explicit unlock call sites: those are the Conversation Mode
 * toggle, the mic button and settings-save -- all of which assume the user TOUCHES
 * one of them in this page load. A returning user whose conversation mode is
 * already persisted ON does not: they open the (installed) PWA, type or dictate,
 * and the first `say` reply arrives with no gesture ever having primed, so mobile
 * drops it silently while desktop speaks. That is exactly the reported "no voice on
 * the phone, voice on the desktop" gap, and it is why priming must not depend on
 * the user happening to tap one specific control.
 *
 * Listeners are capture-phase and passive (they never preventDefault, never
 * stopPropagation, and do not care which element was hit), and they remove
 * themselves as soon as priming succeeds, so this costs one gesture at most.
 * Idempotent: arming twice, or arming when already unlocked, does nothing.
 *
 * Returns true only if it actually armed the net.
 */
export function armTtsGestureUnlock(
	target: GestureTarget | null = typeof document === 'undefined'
		? null
		: document,
	deps: SpeechDeps = browserSpeechDeps(),
): boolean {
	if (ttsUnlocked || gestureUnlockArmed || !target) return false;

	const onGesture = () => {
		// unlockTts() disarms us on success; if it could not prime (no speech
		// synthesis, or the browser refused), stay armed for the next gesture.
		unlockTts(deps);
	};

	disarmGestureUnlock = () => {
		if (!gestureUnlockArmed) return;
		gestureUnlockArmed = false;
		disarmGestureUnlock = null;
		for (const type of GESTURE_EVENTS) {
			try {
				target.removeEventListener(type, onGesture, {capture: true});
			} catch {
				// Never let listener bookkeeping surface as an app error.
			}
		}
	};

	gestureUnlockArmed = true;
	try {
		for (const type of GESTURE_EVENTS) {
			target.addEventListener(type, onGesture, {capture: true, passive: true});
		}
	} catch {
		disarmGestureUnlock?.();
		return false;
	}
	return true;
}

/** Whether the first-gesture priming net is currently armed (test/diagnostic use). */
export function isTtsGestureUnlockArmed(): boolean {
	return gestureUnlockArmed;
}

function browserSpeechDeps(): SpeechDeps {
	if (typeof window === 'undefined') return {synth: null, Utterance: null};
	const w = window as Window & {
		speechSynthesis?: SpeechSynthesis;
		SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
	};
	return {
		synth: w.speechSynthesis ?? null,
		Utterance: w.SpeechSynthesisUtterance ?? null,
	};
}

/**
 * Speak `text` aloud via the browser SpeechSynthesis API, firing EXACTLY ONE
 * utterance. Returns true when an utterance was spoken, false when it did
 * nothing (blank text, or the API is unavailable).
 *
 * - Feature-detected: when `speechSynthesis` / `SpeechSynthesisUtterance` are
 *   not present (unsupported browser, SSR), this is a silent no-op — never a
 *   throw — so callers need no guard of their own.
 * - `lang`: when a non-empty speech locale is provided it is set on the
 *   utterance so the voice matches the configured speech language; when omitted
 *   the browser default voice/lang is used. A locale the engine has NO voice for
 *   is DROPPED rather than set, because setting it is a known way to get silence
 *   on mobile (see resolveUtteranceLang).
 * - A defensive `resume()` kick is issued first: mobile Chrome can leave the
 *   utterance queue paused, which drops the utterance even once the session has
 *   been gesture-unlocked (see unlockTts). On desktop / an unpaused queue this is
 *   a no-op, so behaviour there is unchanged.
 *
 * `deps` is injectable for testing; production callers omit it and get the real
 * browser APIs.
 */
export function speakUtterance(
	text: string,
	lang?: string,
	deps: SpeechDeps = browserSpeechDeps(),
): boolean {
	const spoken = (text ?? '').trim();
	if (!spoken) return false;

	const {synth, Utterance} = deps;
	if (!synth || !Utterance) return false;

	// Track this utterance for the TTS-settle signal: it is outstanding until the
	// browser fires onend (finished) or onerror (failed). Both settle it (via
	// settleOnce, guarded so double-firing cannot double-decrement), so a failed
	// or duplicate-event utterance never wedges the hands-free loop "speaking"
	// forever. If anything below throws (or speak was never issued) we settle it
	// immediately so the count cannot leak.
	outstandingUtterances++;
	let settled = false;
	const settleOnce = () => {
		if (settled) return;
		settled = true;
		settleOneUtterance();
	};

	try {
		resumeQueue(synth);
		const utterance = new Utterance(spoken);
		const resolvedLang = resolveUtteranceLang(lang, loadVoices(synth));
		if (resolvedLang) {
			utterance.lang = resolvedLang;
		}
		utterance.onend = settleOnce;
		utterance.onerror = settleOnce;
		synth.speak(utterance);
		return true;
	} catch {
		// A spoken reply is a nicety, never a hard requirement: swallow any
		// browser-side failure rather than surface it in the chat. Settle the
		// utterance we optimistically counted so the signal does not leak.
		settleOnce();
		return false;
	}
}
