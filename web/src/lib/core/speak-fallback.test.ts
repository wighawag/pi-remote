import {describe, it, expect} from 'vitest';
import {
	FALLBACK_MAX_CHARS,
	shouldSpeakFallback,
	spokenFallbackText,
} from './speak-fallback.js';

// The spoken-reply FALLBACK: conversation mode must not go silent just because a
// model ignored the "also call `say`" instruction for a turn. These pin the pure
// seam ChatMessageList.svelte's settle-edge driver consumes: WHAT is worth
// speaking out of a written markdown reply, and WHETHER a settled turn should be
// spoken at all.

describe('spokenFallbackText', () => {
	it('speaks a short plain reply as-is', () => {
		expect(spokenFallbackText('The build passed.')).toBe('The build passed.');
	});

	it('is empty for a blank reply (nothing to speak)', () => {
		expect(spokenFallbackText('')).toBe('');
		expect(spokenFallbackText('   \n  ')).toBe('');
	});

	it('drops fenced code blocks, keeping the prose around them', () => {
		const reply =
			'Run this:\n\n```bash\npnpm test --watch\n```\n\nThen check the output.';
		const spoken = spokenFallbackText(reply);
		expect(spoken).toContain('Run this:');
		expect(spoken).toContain('Then check the output.');
		expect(spoken).not.toContain('pnpm test');
	});

	it('is empty when the reply is ONLY code (there is nothing to say)', () => {
		expect(spokenFallbackText('```\nconst x = 1;\n```')).toBe('');
	});

	it('drops an unterminated code fence rather than speaking it', () => {
		expect(spokenFallbackText('Here:\n\n```ts\nconst x = 1;')).toBe('Here:');
	});

	it('keeps link TEXT but never speaks the URL', () => {
		const spoken = spokenFallbackText(
			'See [the docs](https://example.com/a/b?c=d) for more.',
		);
		expect(spoken).toBe('See the docs for more.');
	});

	it('drops bare URLs and images', () => {
		const spoken = spokenFallbackText(
			'Deployed to https://example.com/very/long/path now.',
		);
		expect(spoken).not.toContain('example.com');
		expect(spoken).toContain('Deployed to');
		expect(spokenFallbackText('Look: ![a chart](chart.png) done.')).toBe(
			'Look: done.',
		);
	});

	it('strips markdown structure markers but keeps the words', () => {
		const reply =
			'## Summary\n\n- **three** tests failed\n- the _rest_ passed\n\n> keep going';
		const spoken = spokenFallbackText(reply);
		expect(spoken).toBe(
			'Summary three tests failed the rest passed keep going',
		);
	});

	it('strips inline code markers but keeps the identifier', () => {
		expect(spokenFallbackText('Edit `speak.ts` and retry.')).toBe(
			'Edit speak.ts and retry.',
		);
	});

	it('keeps only the lead-in of a long reply, cut on a sentence boundary', () => {
		const sentence = 'This sentence is a filler used to make the reply long. ';
		const spoken = spokenFallbackText(sentence.repeat(20));
		expect(spoken.length).toBeLessThanOrEqual(FALLBACK_MAX_CHARS);
		expect(spoken.endsWith('.')).toBe(true);
		expect(spoken.startsWith('This sentence is a filler')).toBe(true);
	});

	it('still speaks something when the FIRST sentence alone is enormous', () => {
		const spoken = spokenFallbackText('word '.repeat(400));
		expect(spoken.length).toBeGreaterThan(0);
		expect(spoken.length).toBeLessThanOrEqual(FALLBACK_MAX_CHARS + 3);
		expect(spoken.endsWith('...')).toBe(true);
	});

	it('honours a caller-provided cap', () => {
		const spoken = spokenFallbackText('One. Two. Three. Four. Five.', 12);
		expect(spoken.length).toBeLessThanOrEqual(15);
		expect(spoken.startsWith('One.')).toBe(true);
	});
});

describe('shouldSpeakFallback', () => {
	it('speaks when spoken replies are active and the turn produced no say', () => {
		expect(
			shouldSpeakFallback({
				active: true,
				spokeThisTurn: false,
				reply: 'The build passed.',
			}),
		).toBe(true);
	});

	it('never speaks when the agent already said something (say always wins)', () => {
		expect(
			shouldSpeakFallback({
				active: true,
				spokeThisTurn: true,
				reply: 'The build passed.',
			}),
		).toBe(false);
	});

	it('never speaks when spoken replies are off', () => {
		expect(
			shouldSpeakFallback({
				active: false,
				spokeThisTurn: false,
				reply: 'The build passed.',
			}),
		).toBe(false);
	});

	it('never speaks a turn with nothing speakable (tools only, or code only)', () => {
		expect(
			shouldSpeakFallback({active: true, spokeThisTurn: false, reply: ''}),
		).toBe(false);
		expect(
			shouldSpeakFallback({
				active: true,
				spokeThisTurn: false,
				reply: '```\nx()\n```',
			}),
		).toBe(false);
	});
});
