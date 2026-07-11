---
"wherever-dev": minor
"@wherever-dev/client": minor
---

Make opening a session fast, and add the deterministic fake-LLM integration gate.

Opening a session no longer blocks on building the live agent. Previously `session_load` awaited `createAgentSession` (which resolves extensions and connects MCP servers, seconds of work, occasionally hanging past the client's load watchdog) before sending anything, so returning to an idle-evicted session was slow and could time out. Now the server reads the session header + transcript cheaply and sends `session_created` (with a new `pending` flag) + `message_history` immediately, then builds the agent asynchronously and sends a new `session_ready` message. The client renders and lets you scroll the conversation right away; only the composer stays disabled (with a "Preparing the session agent..." banner) until the agent is ready. A failed cold build degrades to readable-but-not-sendable instead of a hard load failure. Warm (still-resident) sessions skip the pending phase entirely.

Also raised the default session idle-eviction window from 5 to 20 minutes (`PI_IDLE_TIMEOUT`, ms) so a dip-in/dip-out user usually returns to a warm session with no agent rebuild at all.

Foundation: promoted the fake-LLM test substrate (ADR 0001) into `server/test/` and wired `vitest` into the `server` and `client` packages, giving a deterministic, offline integration gate (real server + real pi + fake Anthropic-Messages SSE server). New coverage: server integration tests for fast-first load and a client reducer test for the pending/ready lifecycle.

Protocol: `session_created` gains an optional `pending` flag and there is a new `session_ready` server message. Both are additive and backward compatible (an older client that ignores them simply treats the load as before, seeing history once and the composer enabled on `session_created`).
