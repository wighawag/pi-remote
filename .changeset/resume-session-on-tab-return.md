---
"wherever-dev": patch
"@wherever-dev/client": patch
---

Keep the session cached when the tab is backgrounded instead of reloading it on return.

Previously, backgrounding the tab disconnected and reset the whole client state, so coming back re-fetched and re-rendered the entire session (a visible "reload"). Now the connection is suspended without dropping the cached messages/session: the client records the active session, reconnects preserving the store, and rejoins+resyncs that session in place.

While reconnecting and resyncing, the composer is replaced by a "Reconnecting and syncing session..." status line so no message can be sent until the socket is back and history has resynced.

Also fixes the session error banner: long error text now wraps and scrolls within a bounded area instead of pushing the dismiss (X) button off-screen.
