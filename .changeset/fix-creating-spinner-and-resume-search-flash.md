---
"wherever-dev": patch
"@wherever-dev/client": patch
---

Fix three frontend session-lifecycle bugs and add the first client unit tests.

- Creating a new session no longer spins the blocking "Creating session..." overlay forever when the server reply is lost (slow git init / remote-repo creation, a half-open socket, or an error before the reply is sent). A create watchdog now mirrors the existing load watchdog: it clears the overlay and surfaces a recoverable error instead of forcing a reload.
- Returning to the app (PWA/mobile) after a background suspend no longer flashes the new-session / search empty-state or the big "Not connected" panel over an already-loaded conversation. `suspend()` now correctly reflects the disconnected state so `resume()` actually rejoins in place (it was silently no-op'ing on a stale connected flag and falling through to a session-dropping reconnect). The chat view keeps the cached messages visible during a reconnect, with a thin "Reconnecting and syncing session..." banner over the composer; the sidebar and top-bar search stay usable, and only sending into that one session is blocked.
- An UNSOLICITED socket drop (tab switch, network blip, laptop sleep, half-open reap) no longer silently detaches the frontend from a still-running session. Previously the reconnect neither re-issued `session_load` nor preserved the cached session, so the relay reconnected but the session stream was dead: the UI froze on a stale tool call with "Abort" disabled and no "connecting"/"loading" hint while the agent kept working headless, recoverable only by reload. Now the auto-reconnect preserves the cached conversation, shows the resyncing banner during the backoff, re-attaches to the active session on open, and restores the true streaming state (re-enabling Abort) from the server.
- Added `vitest` to the `client` package with unit tests covering the create watchdog, the suspend/resume-keeps-session invariants, and unsolicited-reconnect re-attachment.
