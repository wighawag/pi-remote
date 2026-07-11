# Plan: speed up session load on return (it is NOT "just reading a file")

**Status:** Diagnosed 2026-07-11. Options A + C IMPLEMENTED 2026-07-11 (behind the
fake-LLM gate); B/D remain optional follow-ups.

## Implemented (2026-07-11)

- **A (view-without-agent) DONE.** `session_load` now does a CHEAP read first
  (`SessionPool.readSessionMeta`: header + transcript, no agent) and sends
  `session_created { pending: true }` + `message_history` immediately, then builds
  the live agent ASYNC and sends the new `session_ready` message. The client gates
  ONLY the composer on `agentPending` (a new `WhereverState` flag) with a
  "Preparing the session agent..." banner; reading/scrolling are instant. A failed
  cold build degrades to readable-but-not-sendable (`session_error`, history
  stays). Warm/resident sessions skip the pending phase entirely.
- **C (idle timeout) DONE.** Default idle eviction raised from 5 min to 20 min
  (`PI_IDLE_TIMEOUT`, ms) so a dip-in/dip-out user usually returns to a warm
  session (no rebuild at all).
- **Gate:** promoted the fake-LLM substrate (ADR 0001) into `server/test/`
  (`harness.ts`, `fake-llm-server.ts`) with `vitest` wired per package. Covered by
  `server/test/fast-session-load.test.ts` (history paints before `session_ready`;
  becomes sendable after ready; warm load has no pending phase) and
  `client/test/agent-pending.test.ts` (reducer contract).

---

**Original diagnosis (kept for the rationale):**
**Symptom:** Returning to the app and opening (or auto-rejoining) a session can
take a long time and sometimes hit the client's 12s load watchdog -> "Loading the
session timed out." It feels like it should be instant ("it is just reading a
file").

## Why it is slow (measured, not assumed)

Opening a session on the server is `SessionPool.loadSession()`
(`server/src/session-pool.ts`). When the session is NOT already resident in the
pool, this does far more than read a file:

1. `SessionManager.open(file).getEntries()` parses the whole `.jsonl`.
2. `resourceLoader.reload()` resolves and loads **extensions/packages** and
   connects **MCP servers** for the cwd. This agent dir has
   `npm:pi-mcp-adapter` configured (`~/.pi/agent/settings.json`), so a cold load
   resolves that extension and connects its MCP server(s).
3. `createAgentSession(...)` bootstraps a full pi agent (auth, model registry,
   settings, resource set, session replay) and returns a live `agentSession`.

### The file read is NOT the bottleneck

Measured on the largest real session (`blender-test`, **21.1 MB**): it is only
**125 lines** (a few enormous tool-output lines), and a raw `readFileSync` +
`JSON.parse` of every line takes **~60 ms total** (35 ms read, 26 ms parse). So
history I/O is cheap even for the biggest files. The cost is steps 2-3:
**rebuilding the agent runtime (extension resolution + MCP connection + agent
bootstrap)**, which is seconds, and can HANG (exceeding the 12s watchdog) if an
MCP server is slow/unreachable.

### Why a return pays this cost at all

The pool idle-evicts sessions after **5 minutes**
(`idleTimeoutMs = 300_000`; `scheduleIdleCheck` -> `destroySession` when
`clients.size === 0 && isIdle`). So:

- Leave for < 5 min and come back: the session is still resident -> `loadSession`
  hits `this.sessions.has(resolvedFile)` and returns immediately (fast).
- Leave for > 5 min (typical for "came back later"): the session was destroyed
  (`agentSession.dispose()`), so the return pays the FULL cold
  `createAgentSession` cost again. This is the slow/timeout case.

The reconnect re-attach we just added (auto `session_load` on any reconnect that
holds a session) makes this correctness-critical, but it also means a cold,
evicted session is reloaded automatically on return, surfacing the cost.

## Options (best first)

### A. Do not require a live agent just to VIEW history (biggest win)
Split "read the transcript" from "instantiate the agent". Reading + rendering the
last window of messages needs only `SessionManager.open().getEntries()` (~60ms),
NOT `createAgentSession`. Serve `message_history` from a cheap read immediately,
and lazily/asynchronously build the live `agentSession` only when the user
actually sends (or when the session is known to be mid-stream and must be
followed). This makes "open a session to read it" near-instant regardless of
idle eviction, and removes the MCP-connection cost from the read path.
- Protocol shape: `session_load` returns header + history right away
  (`session_created` + `message_history`), then a later `session_ready` (or the
  existing `isStreaming`/`context_usage`) once the agent is live. The composer
  stays disabled (with a small "preparing agent..." hint) until ready, but
  reading and scrolling work immediately.

### B. Make the cold load not hang / not blow the watchdog
- Bound/parallelize MCP connection in `resourceLoader.reload()` on the wherever
  side is not possible (it is pi-internal), but wherever CAN: (i) surface a
  distinct, longer "preparing agent (connecting tools)..." state instead of the
  generic 12s load watchdog, and (ii) raise/replace the client
  `LOAD_WATCHDOG_MS` for the agent-build phase so a legitimately slow MCP start
  does not present as a hard timeout. (The watchdog is right for a lost reply;
  wrong for a known-slow build.)
- Consider a server-side timeout around `createAgentSession` that still returns
  the readable history (Option A) even if the live agent fails to build, so a
  bad MCP server degrades to read-only instead of a total load failure.

### C. Tune / stagger idle eviction
- 5 min is aggressive for a dip-in/dip-out mobile usage pattern. Raising
  `idleTimeoutMs` (e.g. 20-30 min) keeps recently-used sessions warm so a return
  is the fast resident path. Trade-off: memory + held MCP connections per live
  session. Could be config-driven, or "keep the last N sessions warm (LRU)"
  rather than a flat timeout.
- Independent of A/B; a cheap partial mitigation.

### D. Window the history READ, not just the slice
`getSessionHistoryWindow` currently parses ALL entries then slices to the last
60. Cheap today (~60ms), so low priority, but if sessions grow much larger a
tail-read (parse from the end, stop after `limit` renderable messages) removes
even that. Do only if A/C are not enough.

## Recommended sequencing
1. **A** (view-without-agent) - the structural win; makes reads instant and
   removes MCP cost + hang risk from the read path. Fits step 2's scoped-loading
   model: "block only the composer until the agent is ready", not the whole view.
2. **C** (idle timeout / LRU warm set) - cheap, orthogonal, immediate relief.
3. **B** (distinct preparing state + watchdog tiering) - polish so a slow agent
   build is legible, not a timeout.
4. **D** only if needed.

## Acceptance / verification (ties into the fake-LLM gate, ADR 0001)
- Integration test: boot the real server against the fake LLM, load a large
  pre-seeded session, assert `message_history` arrives well under a read-only
  budget (e.g. < 500ms) EVEN when the agent build is artificially slowed.
- Assert the composer is disabled with a "preparing agent" affordance until the
  agent is ready, and that reading/scrolling work before then.
- Assert an MCP/agent-build failure degrades to readable-but-not-sendable, not a
  hard load failure.

## Pointers
- `server/src/session-pool.ts`: `loadSession` (the cold path + `createAgentSession`
  + `resourceLoader.reload()`), `getSessionHistory`/`getSessionHistoryWindow`,
  `scheduleIdleCheck`/`destroySession`/`idleTimeoutMs`.
- `server/src/index.ts`: `case 'session_load'` (awaits `loadSession` before
  sending `session_created` + `message_history`).
- `client/src/client.ts`: `LOAD_WATCHDOG_MS` (12s), `armLoadWatchdog`.
- Config: `~/.pi/agent/settings.json` (`npm:pi-mcp-adapter`).
