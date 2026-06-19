---
"wherever-dev": patch
"@wherever-dev/client": patch
---

Fix a "Loading session..." spinner that could hang forever, and stop losing a typed message during session resync.

Stuck loading state (hash auto-join, sidebar selection, and tab-return after >8s):

- web: only take the resume (preserve-cache, rejoin-in-place) path when a session was actually suspended; otherwise do a plain `connect()` so the hash auto-join drives the load.
- web: make the hash auto-join self-healing by gating on live state (active session id + loading/resync flags) instead of a latched guard that connect/disconnect churn could strand, and debounce the join via a single tracked timer.
- client: add a session-load watchdog. The loading/resync flags are set the moment a `session_load` is issued and cleared when `message_history` (or an error/conflict/disconnect) arrives; if none ever comes back (a lost reply, a half-open socket, or any unforeseen edge), the watchdog now clears the flags and surfaces a recoverable error instead of spinning forever. Armed for the sidebar/hash join and the resume-on-reconnect path alike.
- client: add `hasSuspendedSession()` so callers can choose resume vs. plain connect.

Lost message draft during resync:

- web: keep the composer (ChatInput) mounted during reconnect/resync instead of swapping it for a status line, showing a thin "Reconnecting and syncing session..." banner above a disabled input so the in-progress text stays in the live DOM.
- web: also persist the draft to localStorage and restore it on (re)mount, so the typed message survives even a full unmount or reload. The draft is cleared automatically on a successful send. Drafts are scoped per session, with the no-session search composer getting its own shared draft: switching contexts does not carry text over (the box swaps to the target's own draft, or empties), and returning to a session (or back to search mode by closing the session or hitting the search button) brings its draft back.
