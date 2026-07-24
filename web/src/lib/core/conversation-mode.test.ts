import {describe, it, expect} from 'vitest';
import {
	CONVERSATION_KNOBS,
	KNOB_STORAGE,
	isKnobActive,
	bundleOn,
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
