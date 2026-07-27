// Conversation mode is a saved PRESET over a set of independent boolean knobs.
// A single "Conversation Mode" master toggle flips the configured bundle ON and
// GATES the purely-conversation knobs; when it is off those knobs are dormant
// and the default typing-first experience is unchanged. This module is the pure
// registry + gating logic: which knobs exist, where each one's single canonical
// persisted home is, and whether a given knob is currently ACTIVE. The actual
// localStorage read/write + reactive stores live in wherever.ts (mirroring the
// beepDefault persisted-flag pattern); the behaviours the knobs drive (TTS, the
// say card, collapse-long-replies, hands-free mic re-open) are SEPARATE tasks
// that READ these knobs. This task owns the registry + toggle + persistence +
// gating only.

/**
 * The full set of conversation-mode knobs.
 *
 * - `conversationMode` is the MASTER toggle; the others are the bundle it gates.
 * - `autoSendOnSpeechEnd` is NOT a new flag: it IS the pre-existing `directSend`
 *   (send-on-speech-end) surfaced as a conversation knob. It therefore keeps the
 *   existing `wherever-speech-direct-send` home (see KNOB_STORAGE) and its
 *   standalone behaviour is NOT suppressed when the master is off (story 14).
 */
export const CONVERSATION_KNOBS = [
	'conversationMode',
	'autoSendOnSpeechEnd',
	'speakReplies',
	'collapseLongReplies',
	'micReopensAfterReply',
] as const;

export type ConversationKnob = (typeof CONVERSATION_KNOBS)[number];

export type ConversationKnobs = Record<ConversationKnob, boolean>;

/**
 * The purely-conversation knobs: those the master toggle gates. Deliberately
 * EXCLUDES `autoSendOnSpeechEnd` (= directSend), whose standalone effect must
 * survive the master being off, and `conversationMode` itself (the master).
 */
export const GATED_KNOBS = [
	'speakReplies',
	'collapseLongReplies',
	'micReopensAfterReply',
] as const;

export type GatedKnob = (typeof GATED_KNOBS)[number];

/**
 * The single canonical persisted home for each knob. Exactly one home per knob;
 * no knob is stored in two places and no key is shared by two knobs.
 *
 * - `store: 'speech'` knobs live under a `wherever-speech-*` localStorage key
 *   (the SpeechButton pref pattern). Only `autoSendOnSpeechEnd` uses this, and
 *   it reuses the EXISTING `wherever-speech-direct-send` key so it is the SAME
 *   underlying value as `directSend` (no forked second flag).
 * - `store: 'config'` knobs live as a boolean field in the single
 *   `wherever-config` localStorage entry via getConfig()/saveConfig() (the
 *   beepDefault pattern).
 *
 * NOTE for `conversationMode` (the master): its config field is the per-session
 * DEFAULT, not the effective value. The master is scoped PER CONVERSATION (see
 * resolveConversationMode + the override map in wherever.ts), so the config field
 * answers "what should a conversation that has not been toggled use?".
 */
export const KNOB_STORAGE: {
	readonly [K in ConversationKnob]:
		| {store: 'speech'; key: string}
		| {store: 'config'; field: K};
} = {
	conversationMode: {store: 'config', field: 'conversationMode'},
	autoSendOnSpeechEnd: {store: 'speech', key: 'wherever-speech-direct-send'},
	speakReplies: {store: 'config', field: 'speakReplies'},
	collapseLongReplies: {store: 'config', field: 'collapseLongReplies'},
	micReopensAfterReply: {store: 'config', field: 'micReopensAfterReply'},
};

function isGated(knob: ConversationKnob): knob is GatedKnob {
	return (GATED_KNOBS as readonly string[]).includes(knob);
}

/**
 * Whether a knob is currently ACTIVE, i.e. its effect should apply right now.
 *
 * - A purely-conversation (gated) knob is active only when BOTH the master
 *   `conversationMode` is on AND the knob itself is set. With the master off it
 *   is dormant (no TTS, no collapse, no mic re-open) so behaviour matches the
 *   typing-first default.
 * - `autoSendOnSpeechEnd` (= directSend) is NOT gated: its own value alone
 *   decides, regardless of the master, so a standalone-set directSend still
 *   auto-sends with the mode off (story 14) and today's behaviour is preserved.
 * - `conversationMode` (the master) is active exactly when it is set.
 */
export function isKnobActive(
	knob: ConversationKnob,
	knobs: ConversationKnobs,
): boolean {
	if (isGated(knob)) {
		return knobs.conversationMode && knobs[knob];
	}
	// autoSendOnSpeechEnd and conversationMode: ungated, own value decides.
	return knobs[knob];
}

/**
 * Whether an outgoing user message should carry the per-turn conversation-mode
 * SIGNAL (the optional `conversationMode` field on the existing `message` WS
 * payload), which tells the agent a spoken conversation is active so it adds a
 * short `say` reply to its written answer.
 *
 * True iff BOTH the master `conversationMode` and `speakReplies` are active: a
 * "please also speak" hint is pointless when spoken output is off. That is exactly
 * the existing gate for `speakReplies`, so this REUSES isKnobActive rather than
 * re-deriving the rule (one definition of "spoken replies are on right now").
 */
export function shouldSignalConversationMode(
	knobs: ConversationKnobs,
): boolean {
	return isKnobActive('speakReplies', knobs);
}

/**
 * Flip the master toggle ON. Conversation mode is a saved bundle of the user's
 * independently-configured knobs, so turning it on turns the master on and
 * leaves every other knob at its configured value (it does NOT force them all
 * on). The configured gated knobs then become active via isKnobActive.
 */
export function bundleOn(knobs: ConversationKnobs): ConversationKnobs {
	return {...knobs, conversationMode: true};
}

/**
 * The effective master toggle for ONE conversation.
 *
 * The master is PER CONVERSATION, not global: a spoken exchange is a property of
 * the conversation you are having, not of the app. Turning it on in the bar while
 * talking to one session must not start speaking replies in every other session
 * (and, on the wire, must not stamp the conversation-mode signal on messages sent
 * from them). So each session can hold its OWN explicit choice, and the config
 * flag is the DEFAULT a session uses until it is toggled.
 *
 * "Unset" is a real, distinct state, exactly as it is for the waiting-for-human
 * beep (whose per-session override this mirrors deliberately):
 * - a session with NO override FOLLOWS the default, live: change the default and
 *   that session changes with it;
 * - once toggled, the session's own choice STICKS and later default changes do
 *   not move it, until it is cleared back to "follow default".
 *
 * The gated knobs (speakReplies, collapseLongReplies, micReopensAfterReply) stay
 * GLOBAL settings: they describe HOW a spoken conversation behaves, and the user
 * configures that once. Only WHETHER this conversation is a spoken one is per
 * conversation.
 */
export function resolveConversationMode(
	override: boolean | undefined,
	defaultOn: boolean,
): boolean {
	return override === undefined ? defaultOn : override;
}
