---
title: Client composer re-enables off resyncing/message_history slightly before the server re-attaches the connection, leaving an advisory-only send gate
type: observation
status: spotted
spotted: 2026-07-14
---

# Client-side send gate is advisory and can open before the server re-attaches the session

## What was seen

While diagnosing the message-misroute bug (a message delivered to the wrong session's agent after a switch/reload), the server-side fix landed: the `message`/`abort` handlers in `server/src/index.ts` now treat the client-stamped `msg.sessionId` as authoritative and refuse a mismatch, so a message can no longer be misrouted regardless of client timing. That fix is complete and tested (`server/test/message-session-authority.test.ts`).

Separately, and NOT fixed, the CLIENT-side gate that is supposed to prevent sending during a switch/reconnect/resync window is purely advisory state and can enable the composer slightly before the server has re-attached the connection:

- On reconnect/resume the client sets `resyncing: true` and re-issues `session_load` (`client/src/client.ts` `resume()` / `onOpen`, around `client.ts:227-229`). `resyncing` is then cleared by the `message_history` reducer (`client.ts:1180`).
- On a cold load the server sends `session_created(pending:true)` + `message_history` IMMEDIATELY (cheap read), but only sets the per-connection `client.sessionId` seconds later inside the async agent-build block, and emits `session_ready` at that point (`server/src/index.ts` `session_load` cold path). A reconnected socket even starts with `client.sessionId = null`.
- So `message_history` (which clears `resyncing`) arrives BEFORE the server has re-attached and BEFORE `session_ready`. The intended cold-load block is `agentPending` (set from `session_created.pending`), and `sendMessage()` does check `agentPending` (`client.ts:1473`). But the gate is a set of separate booleans (`resyncing`, `agentPending`, `readOnly`, `sessionId != null`) cleared at points that do not all coincide with the server's re-attach, and every send surface (ChatInput, the search-mode `queueMicrotask` send at `wherever.ts:260`, `resendMessage`, any programmatic caller) must honour them perfectly.

## Why it matters

The correctness hole is now closed server-side, so this is a UX-quality issue, not a data-safety one: if the client's advisory gate has a timing hole, the user's send is now REFUSED with a `session_error` (recoverable, retryable via the delivery watchdog + Retry) rather than misrouted. But that means a user could occasionally hit a "not delivered, please resend" on a fast switch-then-type, which is avoidable.

## Possible tightening (NOT implemented, deliberately)

Key the client's "is this session sendable" decision strictly off a single condition that tracks the server's re-attach (e.g. gate on `agentPending === false` AND an explicit attached/ready flag that only `session_ready` sets, rather than letting `message_history`/`resyncing` alone re-open the composer). This would make the server-side refusal path rarely hit at all. Left unimplemented on purpose: the server-side backstop already guarantees correctness, and changing the composer-enable timing touches several surfaces and the resync UX, so it wants its own scoped change + tests rather than riding along with the routing fix.

## Refs

- `server/src/index.ts` — `case 'message'` / `case 'abort'` (authority guard, the fix)
- `client/src/client.ts:227-229` (`onOpen` resync re-load), `:1180` (`message_history` clears `resyncing`), `:1473` (`sendMessage` checks `agentPending`)
- `web/src/lib/wherever.ts:260` (search-mode `queueMicrotask` send surface)
- `server/test/message-session-authority.test.ts` (regression test for the server-side fix)
