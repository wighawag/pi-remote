---
"wherever-dev": patch
"@wherever-dev/client": patch
---

Stop silently losing (or wrongly queueing) a message sent right after returning to a backgrounded/idle tab.

Two related failures, both rooted in the suspend/resume-on-background path:

- Lost message: `send()` silently dropped any frame issued on a non-OPEN socket (null / CONNECTING / CLOSING / half-open), so a message typed during the reconnect+resync window rendered locally but never reached the server and was gone after reload. `send()` now reports whether the frame actually went out, and `sendMessage()` checks the real socket `readyState` (via `getIsConnected()`, not the laggy store `connected` flag) and only commits the local echo + clears the error after the frame is confirmed sent; on failure it surfaces a recoverable "not connected, your message was not sent" error, ensures a reconnect is scheduled, and returns `false`. `sendMessage()` now returns a success boolean so the composer only clears the textarea on a real send: a dropped send keeps the typed text intact for retry instead of losing it.

- Cannot send while disconnected + clear status: the chat composer is now disabled when the socket is not connected (previously only gated on having a session, so you could press send into a dead socket). The placeholder and the existing status line now show "Reconnecting to remote server..." / "Disconnected - cannot send" so the connection state is visible.

- Wrongly queued, never drained: `isStreaming` could stay stuck `true` across a suspend/resume (the `agent_end` that would clear it arrives on the now-dead socket), so the composer queued the next message as if the agent were still busy, and the queue never drained. `suspend()` now clears the stale `isStreaming` (the authoritative value is re-established by `session_created` on rejoin), `disconnect()` cancels any pending `agent_end` clear timer so it cannot fire against a fresh connection, and the composer only queues when streaming AND connected (and only auto-drains the queue when connected), falling through to a clear error otherwise.
