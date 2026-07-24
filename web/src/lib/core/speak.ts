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

	try {
		const utterance = new Utterance(spoken);
		if (lang && lang.trim()) {
			utterance.lang = lang.trim();
		}
		synth.speak(utterance);
		return true;
	} catch {
		// A spoken reply is a nicety, never a hard requirement: swallow any
		// browser-side failure rather than surface it in the chat.
		return false;
	}
}
