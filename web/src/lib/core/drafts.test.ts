import {describe, it, expect} from 'vitest';
import {
	applyDraft,
	decideDraftLoad,
	draftOriginLabel,
	draftPreview,
	draftToConsumeOnSend,
	normalizeDrafts,
	parseDrafts,
	serializeDrafts,
	sortDrafts,
	type Draft,
} from './drafts.js';

// The client half of saved drafts. The SERVER owns the list (ids, dedupe, cap,
// ordering -- pinned in server/test/drafts.test.ts); what is pinned here is what
// the server cannot know: what loading a draft does to the composer, and that a
// corrupt local mirror (or a response from something that is not a wherever
// server) degrades to an empty list instead of breaking the composer.

function draft(over: Partial<Draft> = {}): Draft {
	return {
		id: 'a',
		text: 'hello',
		createdAt: 1000,
		updatedAt: 1000,
		...over,
	};
}

describe('parseDrafts / normalizeDrafts', () => {
	it('round-trips the local mirror', () => {
		const list = [
			draft({id: 'a', text: 'one', updatedAt: 2}),
			draft({id: 'b', text: 'two', updatedAt: 1, cwd: '/tmp/x'}),
		];
		expect(parseDrafts(serializeDrafts(list))).toEqual(list);
	});

	it('treats missing/blank/corrupt storage as an empty list', () => {
		expect(parseDrafts(null)).toEqual([]);
		expect(parseDrafts('')).toEqual([]);
		expect(parseDrafts('{not json')).toEqual([]);
		expect(parseDrafts('{"drafts":[]}')).toEqual([]);
	});

	it('drops malformed members instead of repairing them', () => {
		expect(
			normalizeDrafts([
				{id: 'ok', text: 'keep me', createdAt: 5, updatedAt: 5},
				{text: 'no id', createdAt: 1, updatedAt: 1},
				{id: 'blank', text: '   ', createdAt: 1, updatedAt: 1},
				{id: 'nontext', text: 42},
				null,
				'nope',
			]).map((d) => d.id),
		).toEqual(['ok']);
	});

	it('tolerates a non-list response', () => {
		expect(normalizeDrafts(undefined)).toEqual([]);
		expect(normalizeDrafts({drafts: []})).toEqual([]);
	});

	it('backfills a missing updatedAt from createdAt and sorts newest first', () => {
		const parsed = normalizeDrafts([
			{id: 'old', text: 'old', createdAt: 10},
			{id: 'new', text: 'new', createdAt: 20},
		]);
		expect(parsed.map((d) => d.id)).toEqual(['new', 'old']);
		expect(parsed[0].updatedAt).toBe(20);
	});
});

describe('decideDraftLoad', () => {
	it('warns only when the box holds real text', () => {
		expect(decideDraftLoad('half typed')).toBe('confirm');
		expect(decideDraftLoad('')).toBe('load');
		expect(decideDraftLoad('  \n\t ')).toBe('load');
	});
});

describe('applyDraft', () => {
	it('replaces the box wholesale', () => {
		expect(applyDraft('typed', 'saved', 'replace')).toBe('saved');
		expect(applyDraft('', 'saved', 'replace')).toBe('saved');
	});

	it('appends below the typed text, separated by a blank line', () => {
		expect(applyDraft('typed', 'saved', 'append')).toBe('typed\n\nsaved');
		expect(applyDraft('typed  \n\n', 'saved', 'append')).toBe('typed\n\nsaved');
	});

	it('appending into an empty box is just the draft', () => {
		expect(applyDraft('', 'saved', 'append')).toBe('saved');
		expect(applyDraft('   ', 'saved', 'append')).toBe('saved');
	});
});

describe('draftToConsumeOnSend', () => {
	const source = {id: 'd1', text: 'ship the release'};

	it('consumes the draft when the loaded text is sent as-is', () => {
		expect(draftToConsumeOnSend(source, 'ship the release')).toBe('d1');
		expect(draftToConsumeOnSend(source, '  ship the release  ')).toBe('d1');
	});

	it('consumes it when it was appended below typed text', () => {
		// Exactly the shape applyDraft(..., 'append') produces.
		expect(
			draftToConsumeOnSend(
				source,
				applyDraft('context first', source.text, 'append'),
			),
		).toBe('d1');
	});

	it('does NOT consume a short draft that merely appears inside another message', () => {
		// The dangerous direction: short reusable prompts are exactly what people
		// save, and a substring match would delete one whenever it happened to
		// occur inside an unrelated message sent while it was still loaded.
		const short = {id: 'd2', text: 'run the tests'};
		expect(
			draftToConsumeOnSend(short, 'please run the tests and report back'),
		).toBe(null);
		expect(draftToConsumeOnSend(short, 'run the tests now')).toBe(null);
		// A one-line preamble is not the append shape either (no blank line).
		expect(draftToConsumeOnSend(short, 'hey\nrun the tests')).toBe(null);
	});

	it('keeps the draft when the text was edited beyond it', () => {
		// The safe direction: a wrong guess here would delete words the user
		// wanted to keep, so anything that is no longer the draft verbatim leaves
		// the draft alone.
		expect(draftToConsumeOnSend(source, 'ship the RELEASE')).toBe(null);
		expect(draftToConsumeOnSend(source, 'ship the')).toBe(null);
		expect(draftToConsumeOnSend(source, 'something else entirely')).toBe(null);
	});

	it('is inert with no loaded draft or an empty send', () => {
		expect(draftToConsumeOnSend(null, 'ship the release')).toBe(null);
		expect(draftToConsumeOnSend(source, '   ')).toBe(null);
	});
});

describe('draftPreview', () => {
	it('flattens newlines into a single row', () => {
		expect(draftPreview('line one\n\nline  two')).toBe('line one line two');
	});

	it('truncates past the limit', () => {
		const preview = draftPreview('x'.repeat(200), 20);
		expect(preview).toHaveLength(20);
		expect(preview.endsWith('…')).toBe(true);
	});
});

describe('draftOriginLabel', () => {
	it('shows the trailing folder name, or nothing when there is no cwd', () => {
		expect(draftOriginLabel(draft({cwd: '/home/me/dev/wherever'}))).toBe(
			'wherever',
		);
		expect(draftOriginLabel(draft({cwd: '/'}))).toBe('/');
		expect(draftOriginLabel(draft())).toBe(null);
	});
});

describe('sortDrafts', () => {
	it('is deterministic for equal timestamps', () => {
		const list = [
			draft({id: 'b', updatedAt: 5}),
			draft({id: 'a', updatedAt: 5}),
		];
		expect(sortDrafts(list).map((d) => d.id)).toEqual(['a', 'b']);
	});
});
