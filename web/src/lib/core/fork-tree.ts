// Fork-hierarchy ordering for the session sidebar.
//
// Sessions in a folder arrive newest-first (server sorts by `modified`), but the
// sidebar renders them as a TREE: a forked session nests under the session it
// was forked from. Ordering the tree by each root's OWN `modified` buries an
// actively-used fork under an old, long-idle parent, since only the fork gets
// new messages. So a whole fork GROUP (a root plus its descendants) is ranked by
// its most recent activity ACROSS the group, and siblings are ranked the same
// way. The parent still renders above its children (the tree shape is the point);
// what changes is where the group as a whole sits in the list.

/** Minimal shape needed to build/order the tree; matches SessionInfo. */
export interface ForkTreeNodeInput {
	path: string;
	modified: string;
	parentSessionPath?: string;
}

export interface ForkTreeRow<T extends ForkTreeNodeInput> {
	session: T;
	depth: number;
}

/**
 * Flatten sessions into a depth-first fork tree (mirrors pi's session selector).
 * A session whose `parentSessionPath` matches another session's `path` in this
 * list is nested under it; everything else is a root. Cross-folder parents (a
 * fork into a different cwd) surface as roots, since we only tree WITHIN a
 * folder.
 *
 * Roots and sibling children are ordered by the most recent `modified` in their
 * whole subtree (descending), so a group with an active fork floats to the top
 * even when its root is old. Cycle-safe via a visited set; any session dropped
 * by a cycle is appended at depth 0 so nothing vanishes.
 */
export function buildForkTree<T extends ForkTreeNodeInput>(
	sessions: readonly T[],
): ForkTreeRow<T>[] {
	const byPath = new Map<string, T>();
	for (const s of sessions) byPath.set(s.path, s);

	const childrenOf = new Map<string, T[]>();
	const roots: T[] = [];
	for (const s of sessions) {
		const parent = s.parentSessionPath;
		if (parent && byPath.has(parent) && parent !== s.path) {
			if (!childrenOf.has(parent)) childrenOf.set(parent, []);
			childrenOf.get(parent)!.push(s);
		} else {
			roots.push(s);
		}
	}

	// Most recent `modified` across a session and all its descendants. Memoized,
	// and cycle-safe via an in-progress set (a cycle contributes nothing extra).
	const recencyCache = new Map<string, string>();
	const inProgress = new Set<string>();
	const groupRecency = (s: T): string => {
		const cached = recencyCache.get(s.path);
		if (cached !== undefined) return cached;
		if (inProgress.has(s.path)) return s.modified ?? '';
		inProgress.add(s.path);
		let best = s.modified ?? '';
		for (const child of childrenOf.get(s.path) ?? []) {
			const childBest = groupRecency(child);
			if (childBest.localeCompare(best) > 0) best = childBest;
		}
		inProgress.delete(s.path);
		recencyCache.set(s.path, best);
		return best;
	};

	// Newest group first; ties fall back to the session's own `modified` then path
	// so the order is stable and deterministic.
	const byRecency = (a: T, b: T): number =>
		groupRecency(b).localeCompare(groupRecency(a)) ||
		(b.modified ?? '').localeCompare(a.modified ?? '') ||
		a.path.localeCompare(b.path);

	const out: ForkTreeRow<T>[] = [];
	const visited = new Set<string>();
	const walk = (s: T, depth: number) => {
		if (visited.has(s.path)) return;
		visited.add(s.path);
		out.push({session: s, depth});
		for (const child of [...(childrenOf.get(s.path) ?? [])].sort(byRecency))
			walk(child, depth + 1);
	};
	for (const r of [...roots].sort(byRecency)) walk(r, 0);
	// Safety net: include any session dropped by a cycle so nothing vanishes.
	for (const s of sessions)
		if (!visited.has(s.path)) out.push({session: s, depth: 0});
	return out;
}
