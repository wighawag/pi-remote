// Single source of truth for "which top-level view are we in", derived from the
// session lifecycle flags. Both the message area (ChatMessageList) and the
// bottom composer (+page.svelte) key off this so they can never disagree -- the
// bug being fixed was the composer showing the search input while the message
// area showed "Loading session..." because each computed the no-session state
// independently.

export interface SessionViewInputs {
	connected: boolean;
	/** A session's transcript is loaded (activeSessionFile is set). */
	hasSession: boolean;
	/** A fresh session load is in flight (loadingSession). */
	loading: boolean;
	/** A reconnect is rejoining a cached session (resyncing). */
	resyncing: boolean;
	/** A URL hash points at a session we are about to open. */
	hasSessionHash: boolean;
}

/**
 * True when a session is being opened (or reopened) but its transcript is not
 * yet on screen: a fresh load, a resync, or a hash that will drive a load. In
 * this window sessionFile is briefly null, but this is NOT the search / new-
 * session home state -- the message area shows a "Loading session..." spinner,
 * so the composer must NOT present the search input.
 */
export function isSessionPendingOpen(i: SessionViewInputs): boolean {
	return i.loading || i.resyncing || i.hasSessionHash;
}

/**
 * True only at the genuine no-session home state where the composer acts as the
 * web-search input: connected, a search folder configured, no active session,
 * and no session mid-open. Mirrors the message area's empty-state condition so
 * the two views stay consistent.
 */
export function isSearchActive(
	i: SessionViewInputs & {searchConfigured: boolean},
): boolean {
	return (
		i.connected &&
		i.searchConfigured &&
		!i.hasSession &&
		!isSessionPendingOpen(i)
	);
}
