# @wherever-dev/client

## 0.2.2

### Patch Changes

- cf11972: Stop silently losing (or wrongly queueing) a message sent right after returning to a backgrounded/idle tab.

  Two related failures, both rooted in the suspend/resume-on-background path:
  - Lost message: `send()` silently dropped any frame issued on a non-OPEN socket (null / CONNECTING / CLOSING / half-open), so a message typed during the reconnect+resync window rendered locally but never reached the server and was gone after reload. `send()` now reports whether the frame actually went out, and `sendMessage()` checks the real socket `readyState` (via `getIsConnected()`, not the laggy store `connected` flag) and only commits the local echo + clears the error after the frame is confirmed sent; on failure it surfaces a recoverable "not connected, your message was not sent" error, ensures a reconnect is scheduled, and returns `false`. `sendMessage()` now returns a success boolean so the composer only clears the textarea on a real send: a dropped send keeps the typed text intact for retry instead of losing it.
  - Cannot send while disconnected + clear status: the chat composer is now disabled when the socket is not connected (previously only gated on having a session, so you could press send into a dead socket). The placeholder and the existing status line now show "Reconnecting to remote server..." / "Disconnected - cannot send" so the connection state is visible.
  - Wrongly queued, never drained: `isStreaming` could stay stuck `true` across a suspend/resume (the `agent_end` that would clear it arrives on the now-dead socket), so the composer queued the next message as if the agent were still busy, and the queue never drained. `suspend()` now clears the stale `isStreaming` (the authoritative value is re-established by `session_created` on rejoin), `disconnect()` cancels any pending `agent_end` clear timer so it cannot fire against a fresh connection, and the composer only queues when streaming AND connected (and only auto-drains the queue when connected), falling through to a clear error otherwise.

- 605693a: Fix the sidebar getting stuck on "Loading session..." when switching sessions, where the previous session would close but the sidebar stayed open over a hanging spinner and tapping other sessions appeared to do nothing.
  - client: add an atomic `switchSession()` that leaves the current session (if any) and loads the target in a single step. The UI previously did `leaveSession()` then `joinSession()` separated by a 100ms `setTimeout`; that gap could strand the loading state if a tap landed mid-switch or a leave's follow-up load never fired. `switchSession()` always (re)arms the load watchdog for the new target, so a superseded or lost load can never strand the UI and the latest tap always wins.
  - client: shorten the session-load watchdog from 20s to 12s so a genuinely stuck load surfaces a recoverable error (and frees the UI) sooner.
  - web: the sidebar now closes as soon as a load is in flight (loading/resync), not only once the session id is set. A stalled load no longer leaves the sidebar open on top of the spinner.
  - web: the sidebar session click and the URL-hash change handler both use the atomic `switchSession()` path, removing the fragile leave -> setTimeout -> join dance.

- f9080e1: Fix a "Loading session..." spinner that could hang forever, and stop losing a typed message during session resync.

  Stuck loading state (hash auto-join, sidebar selection, and tab-return after >8s):
  - web: only take the resume (preserve-cache, rejoin-in-place) path when a session was actually suspended; otherwise do a plain `connect()` so the hash auto-join drives the load.
  - web: make the hash auto-join self-healing by gating on live state (active session id + loading/resync flags) instead of a latched guard that connect/disconnect churn could strand, and debounce the join via a single tracked timer.
  - client: add a session-load watchdog. The loading/resync flags are set the moment a `session_load` is issued and cleared when `message_history` (or an error/conflict/disconnect) arrives; if none ever comes back (a lost reply, a half-open socket, or any unforeseen edge), the watchdog now clears the flags and surfaces a recoverable error instead of spinning forever. Armed for the sidebar/hash join and the resume-on-reconnect path alike.
  - client: add `hasSuspendedSession()` so callers can choose resume vs. plain connect.

  Lost message draft during resync:
  - web: keep the composer (ChatInput) mounted during reconnect/resync instead of swapping it for a status line, showing a thin "Reconnecting and syncing session..." banner above a disabled input so the in-progress text stays in the live DOM.
  - web: also persist the draft to localStorage and restore it on (re)mount, so the typed message survives even a full unmount or reload. The draft is cleared automatically on a successful send. Drafts are scoped per session, with the no-session search composer getting its own shared draft: switching contexts does not carry text over (the box swaps to the target's own draft, or empties), and returning to a session (or back to search mode by closing the session or hitting the search button) brings its draft back.

- caabb92: Keep the session cached when the tab is backgrounded instead of reloading it on return.

  Previously, backgrounding the tab disconnected and reset the whole client state, so coming back re-fetched and re-rendered the entire session (a visible "reload"). Now the connection is suspended without dropping the cached messages/session: the client records the active session, reconnects preserving the store, and rejoins+resyncs that session in place.

  While reconnecting and resyncing, the composer is replaced by a "Reconnecting and syncing session..." status line so no message can be sent until the socket is back and history has resynced.

  Also fixes the session error banner: long error text now wraps and scrolls within a bounded area instead of pushing the dismiss (X) button off-screen.

## 0.2.1

### Patch Changes

- 37de34b: Extract core client WebSocket and state management logic into a dedicated, framework-agnostic `@wherever-dev/client` monorepo package. Update both the web dashboard (`@wherever-dev/web`) and the CLI extension (`@wherever-dev/pi`) to use the new shared client, reducing duplicate code and establishing a modular architecture for future integrations.
- ffd28c7: Speed up loading of long sessions with tail-first history windowing. On load/join, the server now sends only the most recent messages (with a total count and offset) instead of the entire history in one payload, and the web dashboard shows a "Load older messages" button that lazily fetches earlier windows (with scroll-position anchoring). This adds `history_load_more` / `message_history_prepend` to the protocol and a `loadMoreHistory()` method plus history pagination state to `@wherever-dev/client`.
