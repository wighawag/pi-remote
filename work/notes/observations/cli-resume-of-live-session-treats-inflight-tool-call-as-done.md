---
title: pi CLI resuming a session that is mid-tool-call elsewhere treats the in-flight tool call as done and waits for user input
type: observation
status: spotted
spotted: 2026-06-22
---

# pi CLI joining a live (web-frontend) session stops at the in-flight tool call

## What was seen

A session is open and ACTIVELY RUNNING in the web frontend (the wherever server
is running its SDK `AgentSession`, agent is mid-turn with a tool call in flight).
The user then joins the SAME session via the pi CLI. The CLI shows a
"session resumed" message and then **does nothing**: it treats the still-running
tool call as if it had already completed and sits waiting for a new user message,
instead of waiting for that tool call to finish.

Expected: the CLI should recognise the turn is still in flight and keep waiting
for the tool call to complete (and surface its result), not declare the turn done
and prompt for input.

## Why it happens (traced, not assumed)

Two separate pi PROCESSES end up "in" one session:

- the wherever server's in-memory `AgentSession` (what the web frontend drives),
  created in `server/src/session-pool.ts` `loadSession()` via `createAgentSession`;
- the user's own pi CLI, which loads the SAME session FILE from disk on resume.

When the web-frontend agent is mid-turn, the LAST entry persisted to the session
`.jsonl` is an `assistant` message carrying a `tool_use` whose matching
`toolResult` has **not been written yet** (the result is still being produced in
the OTHER process and only gets appended when the tool finishes). So the CLI, on
resume, loads a context whose last message is an unresolved `assistant`/tool_use.

pi's agent loop cannot CONTINUE from that state:

- `agentLoopContinue()` in
  `node_modules/.pnpm/@earendil-works+pi-agent-core@0.75.3.../dist/agent-loop.js`
  explicitly throws `"Cannot continue from message role: assistant"` when the
  last context message is an assistant message (lines ~30-33 and ~62-65), and the
  header comment (lines ~19-25) states the precondition: *"The last message in
  context must convert to a `user` or `toolResult` message ... otherwise the LLM
  provider will reject the request."*

So a freshly-resumed CLI has no resumable continuation point: the trailing
tool_use has no result, the loop will not auto-continue, and the CLI falls back
to "turn over, wait for the user." There is no per-tool "still running in another
process" marker in the persisted file for it to wait on.

## Why this is fundamentally a multi-process sharing limit

A live in-flight tool call exists only in the RAM of the process executing it
(the server's `AgentSession`). The on-disk session file is a snapshot that gains
the `toolResult` only AFTER the tool finishes. A second pi process resuming from
that snapshot is by construction looking at a stale, mid-turn state with no way
to observe or await the other process's in-flight work. This is the same family
as the multi-client coherence problems already documented for this repo, but the
trigger here is specifically: **resume of a session whose owning process is
mid-tool-call.**

## Relation to existing notes

- `work/ideas/use-pi-server-side-queue-and-recover-on-reload.md` already covers
  multiple clients / multiple processes on ONE live session diverging (frozen
  HEAD, off-branch messages, "wherever doesn't follow the other client's
  messages", `/resume` not following post-resume arrivals). THIS observation is a
  sharper, narrower symptom of the same root tension (two processes, one live
  session) but specifically at a TOOL-CALL boundary, where the resuming process
  declares the turn done.
- `docs/adr/0002-drain-queue-on-pi-queue-state-not-isstreaming.md` and the
  "turn settled vs isStreaming" analysis are adjacent: both are about clients
  guessing run-state from incomplete signals. Here the CLI guesses "turn done"
  from a trailing assistant/tool_use with no result.

## Possible directions (NOT decided - for a future brief/ADR)

- The bridge / server already knows when a session `isStreaming`
  (`server/src/session-pool.ts` `isStreaming()`). A joining CLI could be told the
  session is actively streaming in another process and refuse to treat the turn
  as complete (e.g. attach as a read-only/observer view of the live run rather
  than resuming the stale file), reusing the existing `takeOver` /
  `session_interrupted` multi-client machinery.
- Longer term this aligns with "make pi's server-side run/queue state the source
  of truth" (the idea above): a joining client should reflect the OWNING
  process's live run state, not re-derive turn-completion from a stale file.

## Update 2026-06-22: can the extension handle `/resume` to keep waiting? (traced against ~/dev/github/wighawag/pi)

Question raised: a user joins via the CLI by running `/resume`; can OUR
extension make the CLI keep waiting on the in-flight tool call instead of
declaring the turn done? Findings:

- **`/resume` flow (pi core):** `AgentSessionRuntime.switchSession()`
  (`packages/coding-agent/src/core/agent-session-runtime.ts`) loads the file and
  fires `session_start` with `reason: "resume"`; it sets agent messages to
  `buildSessionContext()` and then sits IDLE. There is NO auto-continue for a
  transcript whose last message is an `assistant` with an unsatisfied `tool_use`.
- **pi core cannot continue that state anyway:** `Agent.continue()`
  (`packages/agent/src/agent.ts:~348`) throws `"Cannot continue from message
  role: assistant"` unless a steer/follow-up is queued. A dangling `tool_use` is
  a dead end by design (agent-loop header comment: last context message must
  convert to `user`/`toolResult` or the provider rejects the request).
- **This repo makes it worse on register:** when the bridge sends
  `cli_register`, `registerCliSession()` (`server/src/session-pool.ts:~1309`)
  finds the existing `server` session and calls `existing.agentSession.dispose()`
  - so the in-flight tool running in the server/web process is KILLED and its
  result is never written. The CLI then owns a stale snapshot with the dangling
  `tool_use`.
- **Extension API surface (`packages/coding-agent/src/core/extensions/types.ts`):**
  the extension can READ the loaded transcript on resume
  (`ctx.sessionManager.getEntries()` / `getLeafEntry()`), can show UI
  (`setWidget`/`setWorkingMessage`/`notify`/`setStatus`), can `appendEntry` /
  `sendMessage` / `sendUserMessage`, and already receives the OTHER client's
  events via the server's `cli_event` forwarding. But there is NO `ctx.continue()`
  / way to drive the local agent loop to AWAIT a tool result, and the in-flight
  tool runs in the SERVER's `AgentSession`, not the CLI's.

**Conclusion:** the extension ALONE cannot make the local CLI agent resume and
await the other process's in-flight tool call. What is feasible, in order:
1. (extension, easy) On `session_start` `reason==="resume"`, detect a dangling
   `tool_use` (last assistant message with a `tool_use` id lacking a matching
   `toolResult`) and SURFACE it (widget/notify) so the silent "turn done, type
   something" confusion stops.
2. (server, the real fix) In `registerCliSession()`, when the existing `server`
   session `isStreaming`, do NOT `dispose()` it; treat the CLI join as an
   OBSERVER of the live server run (reuse the `takeOver`/`session_interrupted`
   multi-client machinery) so the tool actually completes and broadcasts.
3. (extension, mirror) While observing, drive a working indicator from the
   forwarded `tool_execution_start/end` and append the eventual `toolResult`
   locally so the CLI view converges instead of going idle.

The correct mental model is "joining CLI = observer of the owning process's live
run", NOT "two agents resuming the same file". Item 2 is the load-bearing change;
the extension can only do 1 and 3 on its own.

## Update 2026-06-22: item 1 shipped (detection) + brief filed (observer-on-resume)

- **Item 1 (detection-and-surface) IMPLEMENTED** in `extension/src/index.ts`:
  `findDanglingToolCalls(ctx)` walks the active branch (leaf -> root, mirroring
  `buildSessionContext`) and finds assistant `toolCall` ids with no matching
  `toolResult`. On `session_start` (`reason` resume/reload/startup) it surfaces a
  `notify` + a `wherever-resume-warning` status widget; the warning clears on the
  next `agent_start` and on `session_shutdown`. Changeset:
  `.changeset/cli-resume-mid-tool-call-warning.md` (`@wherever-dev/pi`). This only
  EXPLAINS the dead end; it does not preserve the live run.
- **Items 2+3 (the real fix) FILED as a brief:**
  `work/briefs/ready/cli-observer-on-resume-of-live-session.md`. Core change: stop
  disposing a streaming `server` `AgentSession` on `cli_register`; attach the CLI
  as an OBSERVER of the owning process's run; explicit user-initiated takeover via
  the existing `takeOver()`/`session_interrupted` machinery; extension reflects
  the observed run. Has open questions (observer transport direction,
  render-without-re-persist, takeover UX).

## Refs

- `extension/src/index.ts` (CLI bridge: `session_start` -> `connect()` ->
  `cli_register`; forwards `tool_execution_start/end`, `agent_start/end`;
  NOW ALSO: `findDanglingToolCalls` + resume warning).
- pi core: `packages/coding-agent/src/core/agent-session-runtime.ts`
  (`switchSession`), `packages/agent/src/agent.ts` (`continue()` assistant guard),
  `packages/coding-agent/src/core/extensions/types.ts` (extension API surface).
- `server/src/session-pool.ts` `registerCliSession()` (disposes the live server
  session on CLI register - the kill-the-in-flight-tool step).
- `server/src/session-pool.ts` `loadSession()`, `isStreaming()`,
  `ServerTrackedSession` vs `CliTrackedSession`.
- `node_modules/.pnpm/@earendil-works+pi-agent-core@0.75.3_ws@8.20.1_zod@4.4.3/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js`
  `agentLoopContinue()` (the "Cannot continue from message role: assistant"
  precondition).
