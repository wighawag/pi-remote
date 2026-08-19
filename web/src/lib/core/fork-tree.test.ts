import {describe, it, expect} from 'vitest';
import {buildForkTree} from './fork-tree.js';

// Regression: the sidebar ordered fork groups by the ROOT session's own
// `modified`, so a session forked days ago and worked on all morning sat far
// down the list under its stale parent. A group must rank by its most recent
// message ACROSS the fork tree.

type S = {path: string; modified: string; parentSessionPath?: string};

const s = (path: string, modified: string, parentSessionPath?: string): S => ({
	path,
	modified,
	...(parentSessionPath ? {parentSessionPath} : {}),
});

const flat = (rows: {session: S; depth: number}[]) =>
	rows.map((r) => `${'  '.repeat(r.depth)}${r.session.path}`);

describe('buildForkTree', () => {
	it('nests a fork under its parent', () => {
		const rows = buildForkTree([
			s('/a.jsonl', '2026-01-01T00:00:00Z'),
			s('/b.jsonl', '2026-01-02T00:00:00Z', '/a.jsonl'),
		]);
		expect(flat(rows)).toEqual(['/a.jsonl', '  /b.jsonl']);
	});

	it('ranks a group by its newest fork, not by the root', () => {
		// Old root with a very active fork must beat a newer standalone session.
		const rows = buildForkTree([
			s('/fresh.jsonl', '2026-01-05T00:00:00Z'),
			s('/old-root.jsonl', '2026-01-01T00:00:00Z'),
			s('/active-fork.jsonl', '2026-01-09T00:00:00Z', '/old-root.jsonl'),
		]);
		expect(flat(rows)).toEqual([
			'/old-root.jsonl',
			'  /active-fork.jsonl',
			'/fresh.jsonl',
		]);
	});

	it('propagates recency through a deep fork chain', () => {
		const rows = buildForkTree([
			s('/fresh.jsonl', '2026-01-05T00:00:00Z'),
			s('/root.jsonl', '2026-01-01T00:00:00Z'),
			s('/mid.jsonl', '2026-01-02T00:00:00Z', '/root.jsonl'),
			s('/leaf.jsonl', '2026-01-10T00:00:00Z', '/mid.jsonl'),
		]);
		expect(flat(rows)).toEqual([
			'/root.jsonl',
			'  /mid.jsonl',
			'    /leaf.jsonl',
			'/fresh.jsonl',
		]);
	});

	it('orders siblings by their own subtree recency', () => {
		const rows = buildForkTree([
			s('/root.jsonl', '2026-01-01T00:00:00Z'),
			s('/fork-a.jsonl', '2026-01-02T00:00:00Z', '/root.jsonl'),
			s('/fork-b.jsonl', '2026-01-03T00:00:00Z', '/root.jsonl'),
			s('/fork-a-child.jsonl', '2026-01-08T00:00:00Z', '/fork-a.jsonl'),
		]);
		expect(flat(rows)).toEqual([
			'/root.jsonl',
			'  /fork-a.jsonl',
			'    /fork-a-child.jsonl',
			'  /fork-b.jsonl',
		]);
	});

	it('treats a cross-folder parent as a root and still ranks it by recency', () => {
		const rows = buildForkTree([
			s('/newer.jsonl', '2026-01-04T00:00:00Z'),
			s('/orphan.jsonl', '2026-01-06T00:00:00Z', '/elsewhere/parent.jsonl'),
		]);
		expect(flat(rows)).toEqual(['/orphan.jsonl', '/newer.jsonl']);
	});

	it('is stable for ties and never drops a session in a cycle', () => {
		const rows = buildForkTree([
			s('/x.jsonl', '2026-01-01T00:00:00Z', '/y.jsonl'),
			s('/y.jsonl', '2026-01-01T00:00:00Z', '/x.jsonl'),
			s('/z.jsonl', '2026-01-01T00:00:00Z'),
		]);
		expect(rows.map((r) => r.session.path).sort()).toEqual([
			'/x.jsonl',
			'/y.jsonl',
			'/z.jsonl',
		]);
	});
});
