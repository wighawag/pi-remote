---
"wherever-dev": patch
---

Fix a session-routing bug where a message could be delivered to the wrong session's agent (you switch to a session, post a message, and the agent replies as if it were in a different session). The web client already stamps every send with the `sessionId` of the session it is actually viewing, but the server ignored it and routed by its own per-connection `client.sessionId`, which is only (re)attached when a `session_load` completes. During a switch/reconnect/resync window that value could be stale (a reconnected socket even starts with no attachment, and a cold load attaches only seconds later inside the async agent-build step), so the message went to whatever session the connection was previously attached to.

The `message` and `abort` WS handlers now treat the client-stamped `msg.sessionId` as authoritative: they resolve it through the session pool and verify it maps to the same tracked session the connection is attached to. On a mismatch the send is refused with a `session_error` (surfaced by the client as a recoverable, retryable failure via its delivery watchdog + Retry) instead of being misrouted into another session's agent. Adds an end-to-end regression test (`server/test/message-session-authority.test.ts`) that reproduces the misroute and asserts it is now refused, and that a correctly-stamped send is still delivered.
