import {describe, it, expect} from 'vitest';
import {isSearchActive, isSessionPendingOpen} from './view-mode.js';

// Regression: the composer showed the search input + "Search" button while the
// message area showed "Loading session..." because searchActive only checked
// !sessionFile and ignored the loading/resyncing/hash state. isSearchActive must
// be false whenever a session is mid-open, so the two views stay consistent.

const base = {
	connected: true,
	searchConfigured: true,
	hasSession: false,
	loading: false,
	resyncing: false,
	hasSessionHash: false,
};

describe('isSearchActive', () => {
	it('is true at the genuine no-session home state', () => {
		expect(isSearchActive(base)).toBe(true);
	});

	it('is false while a session is loading (the reported bug)', () => {
		expect(isSearchActive({...base, loading: true})).toBe(false);
	});

	it('is false while a session is resyncing on reconnect', () => {
		expect(isSearchActive({...base, resyncing: true})).toBe(false);
	});

	it('is false when a hash points at a session about to open', () => {
		expect(isSearchActive({...base, hasSessionHash: true})).toBe(false);
	});

	it('is false when a session is already active', () => {
		expect(isSearchActive({...base, hasSession: true})).toBe(false);
	});

	it('is false when disconnected', () => {
		expect(isSearchActive({...base, connected: false})).toBe(false);
	});

	it('is false when no search folder is configured', () => {
		expect(isSearchActive({...base, searchConfigured: false})).toBe(false);
	});
});

describe('isSessionPendingOpen', () => {
	it('is true for loading, resyncing, or a session hash', () => {
		expect(isSessionPendingOpen({...base, loading: true})).toBe(true);
		expect(isSessionPendingOpen({...base, resyncing: true})).toBe(true);
		expect(isSessionPendingOpen({...base, hasSessionHash: true})).toBe(true);
	});

	it('is false at rest with no session opening', () => {
		expect(isSessionPendingOpen(base)).toBe(false);
	});
});
