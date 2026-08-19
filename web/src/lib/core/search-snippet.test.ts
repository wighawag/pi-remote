import {describe, it, expect} from 'vitest';
import {
	snippetSegments,
	snippetPlainText,
	hitKindLabel,
	relativeTime,
	MATCH_START,
	MATCH_END,
} from './search-snippet.js';

const mark = (s: string) => `${MATCH_START}${s}${MATCH_END}`;

describe('snippetSegments', () => {
	it('splits FTS5 markers into plain and highlighted segments', () => {
		expect(snippetSegments(`…the ${mark('flamingo')} protocol…`)).toEqual([
			{text: '…the ', match: false},
			{text: 'flamingo', match: true},
			{text: ' protocol…', match: false},
		]);
	});

	it('handles several matches and a leading match', () => {
		expect(snippetSegments(`${mark('a')} b ${mark('c')}`)).toEqual([
			{text: 'a', match: true},
			{text: ' b ', match: false},
			{text: 'c', match: true},
		]);
	});

	it('returns a single plain segment when nothing is marked', () => {
		expect(snippetSegments('nothing marked here')).toEqual([
			{text: 'nothing marked here', match: false},
		]);
	});

	it('never throws on malformed markers', () => {
		// Unterminated start: highlight to the end rather than losing the text.
		expect(snippetSegments(`tail ${MATCH_START}open`)).toEqual([
			{text: 'tail ', match: false},
			{text: 'open', match: true},
		]);
		// Stray end marker: dropped, text preserved.
		expect(snippetSegments(`stray${MATCH_END} end`)).toEqual([
			{text: 'stray end', match: false},
		]);
		expect(snippetSegments('')).toEqual([]);
	});

	it('strips markers for plain text', () => {
		expect(snippetPlainText(`…the ${mark('flamingo')} protocol…`)).toBe(
			'…the flamingo protocol…',
		);
	});
});

describe('hitKindLabel', () => {
	it('names the chunk kind, not the raw role', () => {
		expect(hitKindLabel('user')).toBe('you');
		expect(hitKindLabel('assistant')).toBe('agent');
		expect(hitKindLabel('name')).toBe('session name');
	});

	it('appends the tool name for tool kinds', () => {
		expect(hitKindLabel('toolCall', 'bash')).toBe('tool: bash');
		expect(hitKindLabel('toolCall', null)).toBe('tool call');
	});

	it('falls back to the kind itself', () => {
		expect(hitKindLabel('weird-new-kind')).toBe('weird-new-kind');
	});
});

describe('relativeTime', () => {
	const now = Date.parse('2026-06-01T12:00:00.000Z');

	it('formats common ages compactly', () => {
		expect(relativeTime('2026-06-01T11:59:30.000Z', now)).toBe('just now');
		expect(relativeTime('2026-06-01T11:30:00.000Z', now)).toBe('30m ago');
		expect(relativeTime('2026-06-01T09:00:00.000Z', now)).toBe('3h ago');
		expect(relativeTime('2026-05-25T12:00:00.000Z', now)).toBe('7d ago');
		expect(relativeTime('2026-01-01T12:00:00.000Z', now)).toBe('5mo ago');
		expect(relativeTime('2024-06-01T12:00:00.000Z', now)).toBe('2y ago');
	});

	it('is empty for missing or unparseable input', () => {
		expect(relativeTime(null, now)).toBe('');
		expect(relativeTime('not a date', now)).toBe('');
	});
});
