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
 *   the browser default voice/lang is used.
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
		const utterance = new Utterance(spoken);
		if (lang && lang.trim()) {
			utterance.lang = lang.trim();
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
