import {describe, it, expect} from 'vitest';
import {
	CONVERSATION_KNOBS,
	KNOB_STORAGE,
	isKnobActive,
	bundleOn,
	resolveConversationMode,
	shouldSignalConversationMode,
	type ConversationKnobs,
} from './conversation-mode.js';

// Conversation mode is a saved BUNDLE of independent boolean knobs. The master
// `conversationMode` toggle GATES the purely-conversation knobs (speakReplies,
// collapseLongReplies, micReopensAfterReply): when it is off they are dormant
// and the default typing-first experience is unchanged. The ONE exception is
// `autoSendOnSpeechEnd`, which IS the existing `directSend` flag surfaced as a
// knob -- it keeps its standalone effect regardless of the master toggle (story
// 14), so a user who set directSend today still auto-sends with the mode off.

const allOn: ConversationKnobs = {
	conversationMode: true,
	autoSendOnSpeechEnd: true,
	speakReplies: true,
	collapseLongReplies: true,
	micReopensAfterReply: true,
};

const modeOffButConfigured: ConversationKnobs = {
	conversationMode: false,
	autoSendOnSpeechEnd: true,
	speakReplies: true,
	collapseLongReplies: true,
	micReopensAfterReply: true,
};

describe('the knob registry', () => {
	it('lists exactly the five conversation knobs', () => {
		expect([...CONVERSATION_KNOBS].sort()).toEqual(
			[
				'autoSendOnSpeechEnd',
				'collapseLongReplies',
				'conversationMode',
				'micReopensAfterReply',
				'speakReplies',
			].sort(),
		);
	});

	it('gives autoSendOnSpeechEnd the SAME canonical home as the existing directSend flag (no forked second key)', () => {
		// The whole coherence decision: autoSendOnSpeechEnd === directSend, so it
		// persists under the pre-existing wherever-speech-* key, NOT a new one.
		expect(KNOB_STORAGE.autoSendOnSpeechEnd).toEqual({
			store: 'speech',
			key: 'wherever-speech-direct-send',
		});
	});

	it('persists the purely-conversation knobs + the master toggle in the single wherever-config entry', () => {
		for (const knob of [
			'conversationMode',
			'speakReplies',
			'collapseLongReplies',
			'micReopensAfterReply',
		] as const) {
			expect(KNOB_STORAGE[knob]).toEqual({store: 'config', field: knob});
		}
	});

	it('gives every knob exactly one canonical home (no key is shared by two knobs)', () => {
		const homes = CONVERSATION_KNOBS.map((k) =>
			JSON.stringify(KNOB_STORAGE[k]),
		);
		expect(new Set(homes).size).toBe(homes.length);
	});
});

// The per-turn signal the client stamps on each send: it exists so the AGENT can
// tell a spoken conversation is active (it otherwise sees a dictated message as
// byte-identical to a typed one) and therefore also calls `say`. It must be sent
// only when spoken output is actually on, i.e. master AND speakReplies.
describe('the outgoing conversation-mode signal', () => {
	it('is sent when the master AND speakReplies are both on', () => {
		expect(shouldSignalConversationMode(allOn)).toBe(true);
	});

	it('is NOT sent when the master is off, however the knobs are configured', () => {
		expect(shouldSignalConversationMode(modeOffButConfigured)).toBe(false);
	});

	it('is NOT sent when speakReplies is off (a speak hint with no TTS is pointless)', () => {
		expect(shouldSignalConversationMode({...allOn, speakReplies: false})).toBe(
			false,
		);
	});

	it('does not depend on the other knobs (collapse / mic re-open / directSend)', () => {
		expect(
			shouldSignalConversationMode({
				conversationMode: true,
				speakReplies: true,
				autoSendOnSpeechEnd: false,
				collapseLongReplies: false,
				micReopensAfterReply: false,
			}),
		).toBe(true);
	});
});

describe('gating: isKnobActive', () => {
	it('with the master OFF, none of the purely-conversation knobs is active', () => {
		expect(isKnobActive('speakReplies', modeOffButConfigured)).toBe(false);
		expect(isKnobActive('collapseLongReplies', modeOffButConfigured)).toBe(
			false,
		);
		expect(isKnobActive('micReopensAfterReply', modeOffButConfigured)).toBe(
			false,
		);
	});

	it('with the master ON, a configured purely-conversation knob is active', () => {
		expect(isKnobActive('speakReplies', allOn)).toBe(true);
		expect(isKnobActive('collapseLongReplies', allOn)).toBe(true);
		expect(isKnobActive('micReopensAfterReply', allOn)).toBe(true);
	});

	it('with the master ON but a knob turned OFF, that knob is not active', () => {
		expect(isKnobActive('speakReplies', {...allOn, speakReplies: false})).toBe(
			false,
		);
	});

	it('autoSendOnSpeechEnd is NOT suppressed by the master being off (story 14)', () => {
		// The standalone directSend value still wins regardless of the mode.
		expect(isKnobActive('autoSendOnSpeechEnd', modeOffButConfigured)).toBe(
			true,
		);
		expect(
			isKnobActive('autoSendOnSpeechEnd', {
				...modeOffButConfigured,
				autoSendOnSpeechEnd: false,
			}),
		).toBe(false);
	});

	it('the master toggle is itself active exactly when set', () => {
		expect(isKnobActive('conversationMode', allOn)).toBe(true);
		expect(isKnobActive('conversationMode', modeOffButConfigured)).toBe(false);
	});
});

describe('bundleOn: flipping the mode ON bundles the configured knobs', () => {
	it('turns the master on and preserves each independently-configured knob', () => {
		const configured: ConversationKnobs = {
			conversationMode: false,
			autoSendOnSpeechEnd: true,
			speakReplies: true,
			collapseLongReplies: false,
			micReopensAfterReply: true,
		};
		const next = bundleOn(configured);
		expect(next.conversationMode).toBe(true);
		// The bundle is the user's configured set; it does not force every knob on.
		expect(next.speakReplies).toBe(true);
		expect(next.collapseLongReplies).toBe(false);
		expect(next.micReopensAfterReply).toBe(true);
		expect(next.autoSendOnSpeechEnd).toBe(true);
	});

	it('flipping the master OFF does NOT force autoSendOnSpeechEnd off', () => {
		// Turning the mode off only dormant-izes the purely-conversation knobs; it
		// must not mutate the shared directSend flag.
		const next = {...allOn, conversationMode: false};
		expect(next.autoSendOnSpeechEnd).toBe(true);
		expect(isKnobActive('autoSendOnSpeechEnd', next)).toBe(true);
	});
});

// The master toggle is scoped PER CONVERSATION over a global default: the bar
// toggle sets the conversation you are in, Connection Settings sets the default
// for conversations that have not been toggled. "Unset" is a real state (mirror
// of the waiting-for-human beep's per-session override).
describe('resolveConversationMode', () => {
	it('follows the default when this conversation has no choice of its own', () => {
		expect(resolveConversationMode(undefined, true)).toBe(true);
		expect(resolveConversationMode(undefined, false)).toBe(false);
	});

	it("uses this conversation's own choice when it has one, either way", () => {
		// Turned ON here while the default is off: only this conversation speaks.
		expect(resolveConversationMode(true, false)).toBe(true);
		// Turned OFF here while the default is on: only this conversation is quiet.
		expect(resolveConversationMode(false, true)).toBe(false);
	});

	it("a conversation's own choice STICKS when the default later changes", () => {
		const chosen = false;
		expect(resolveConversationMode(chosen, false)).toBe(false);
		expect(resolveConversationMode(chosen, true)).toBe(false);
	});
});
