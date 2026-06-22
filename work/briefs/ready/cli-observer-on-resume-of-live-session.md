---
title: CLI join of a live session observes the owning process's run instead of killing it (observer-on-resume)
slug: cli-observer-on-resume-of-live-session
needsAnswers: true
---

> Launch snapshot - records intent at creation, NOT maintained. Current truth:
> the code + `docs/adr/`; remaining work: the tasks sliced from this brief.
> Backing analysis: `work/notes/observations/cli-resume-of-live-session-treats-inflight-tool-call-as-done.md`
> and the multi-client/HEAD-coherence work in
> `work/ideas/use-pi-server-side-queue-and-recover-on-reload.md`.

## Problem Statement

When a session is open and ACTIVELY RUNNING in the web frontend (the standalone
server is driving its in-memory `AgentSession`, agent mid-turn with a tool call
in flight) and the user then joins the SAME session via the pi CLI (`/resume`),
two things go wrong, both traced in the code:

1. **The live run is KILLED on join.** On `cli_register`, the server's
   `registerCliSession()` (`server/src/session-pool.ts`) finds the existing
   `server` session and calls `existing.agentSession.dispose()`. The in-flight
   tool running in the server/web process is terminated and its `toolResult` is
   never written to the session file.
2. **The CLI cannot resume the result.** The CLI loaded the session file as a
   stale snapshot whose last assistant message has a `tool_use` with no matching
   `toolResult`. pi core cannot auto-continue from that state (`Agent.continue()`
   throws `"Cannot continue from message role: assistant"`; the agent loop
   requires the last context message to convert to `user`/`toolResult`). So the
   CLI sits idle as if the turn were done, waiting for user input.

Net effect: joining via the CLI silently destroys in-flight work and leaves the
user staring at a dead, half-finished turn. The detection-and-surface mitigation
(extension widget/notify on resume) ships separately and is NOT a fix: it only
explains the dead end; it does not preserve the run.

The correct model is: **a CLI joining a session that is live in another process
is an OBSERVER of that owning process's run, not a second agent resuming the
file.** Only one process should own/drive a given live session at a time; the
other attaches to watch (and may explicitly take over).

## Solution

Make the server treat a CLI join of a currently-streaming `server` session as an
**observer attach**, and have the extension reflect the observed live run instead
of going idle.

- **Server: do not dispose a streaming server session on CLI register.** When
  `registerCliSession()` finds an existing `server` session that `isStreaming`,
  keep it running and the server stays the owner/driver. The CLI is registered as
  an observer of that session: it receives the server's forwarded agent/tool
  events (the same `onEvent` stream web clients get) over the bridge, but does
  NOT replace the `AgentSession`. The dispose-and-replace path remains only for
  joining an IDLE session (or an explicit takeover).
- **Server: an explicit, user-initiated takeover stays available.** Reuse the
  existing `takeOver()` / `session_interrupted` machinery so the user CAN choose
  to seize ownership (aborting the server run) rather than only observe. The
  difference from today is that takeover becomes a DELIBERATE action, not the
  silent default of merely joining.
- **Extension: reflect the live run while observing.** On `session_start`
  (`reason: "resume"`) into a session the server reports as streaming, the
  extension shows a working indicator / widget driven by the forwarded
  `tool_execution_start`/`tool_execution_end` ("waiting on `bash` running in the
  web frontend..."), and appends the eventual `toolResult` (and subsequent
  assistant turn) into the local view so the CLI converges with the owning
  process instead of declaring the turn done.
- **Extension/server: surface "who owns the run".** The user should always be
  able to tell whether their CLI is OBSERVING (server owns) or DRIVING (CLI owns)
  the session, and how to switch.

This sits directly on top of the test-first hardening foundation
(`work/briefs/ready/wherever-test-first-hardening.md`): the same fake-LLM gate
substrate is what makes the multi-process behaviour testable deterministically.

## User Stories

### Server: observer attach (the load-bearing change)

1. As a user joining (via CLI) a session that is actively streaming in the web
   frontend, I want the web frontend's in-flight tool call to KEEP RUNNING and
   complete, so that joining never destroys work in progress.
2. As a user, when I join a streaming session via the CLI, I want my CLI to
   ATTACH AS AN OBSERVER (the server stays the owner/driver), so that there is
   always exactly one driver of a live session and no silent agent-vs-agent race.
3. As a user joining an IDLE session via the CLI, I want the existing behaviour
   (the CLI becomes the driver), so that the common single-client case is
   unchanged.
4. As a maintainer, I want the dispose-and-replace of a `server` `AgentSession`
   on `cli_register` to happen ONLY for an idle session or an explicit takeover,
   never as the silent side effect of observing a live one.

### User-initiated takeover

5. As a user observing a live session from the CLI, I want an explicit way to
   TAKE OVER (seize ownership, aborting the server-side run), so that I can drive
   from the CLI when I actually intend to, distinct from merely watching.
6. As a user, when a takeover happens, I want the other clients to be told
   (`session_interrupted`) and the abort to be clean, reusing the existing
   takeover machinery, so that takeover is coherent across all attached clients.

### Extension: reflect the observed run

7. As a CLI user observing a live session, I want to SEE the in-flight tool call
   (a working indicator naming the tool, e.g. "waiting on `bash`...") driven by
   the server's forwarded `tool_execution_start`/`end`, so that the CLI shows the
   real run state instead of an idle prompt.
8. As a CLI user observing a live session, I want the tool's eventual result and
   the following assistant turn to appear in my CLI view, so that the CLI
   converges with the owning process rather than freezing at the dangling call.
9. As a CLI user, I want a clear indication of whether my CLI is OBSERVING or
   DRIVING the session (and how to switch), so that ownership is never ambiguous.

### Safety / correctness

10. As a maintainer, I want no path where two processes drive the same live
    session concurrently (the accidental-fork / frozen-HEAD family in the ideas
    note), so that joining cannot manufacture divergent branches.
11. As a maintainer, I want the observer attach + takeover behaviour covered by
    deterministic tests against the fake-LLM gate (a streamed multi-step turn with
    a slow tool, joined mid-tool-call), so that the regression is locked.

## Acceptance

- Joining (CLI) a streaming server session: the server run is NOT disposed, the
  in-flight tool completes, its `toolResult` is persisted, and the CLI observer
  shows the running tool then its result + the next assistant turn. (Story 1, 2,
  7, 8.)
- Joining (CLI) an idle session: unchanged from today (CLI becomes driver).
  (Story 3.)
- An explicit takeover aborts the server run and transfers ownership, emitting
  `session_interrupted` to other clients. (Story 5, 6.)
- No code path disposes a streaming `server` `AgentSession` as a silent side
  effect of `cli_register`. (Story 4.)
- A fake-LLM gate test reproduces "join mid-tool-call" and asserts the tool
  completes + observer convergence (was: run killed, CLI idle). (Story 11.)
- The detection-only mitigation (resume warning widget) is superseded for the
  live-session case: when observing, the CLI shows the live run, not just a
  "resumed mid-run" warning. (The warning remains correct for the
  interrupted/no-owner case.)

## Out of Scope

- Full multi-client HEAD reconciliation / branch-aware rendering and the
  intentional `/fork` feature (`docs/FORK_ANALYSIS.md`). This brief is the
  narrower "don't kill the live run on join; observe it" slice. It MUST NOT
  manufacture forks (story 10), but it does not deliver general HEAD
  reconciliation.
- Changing pi core. The fix is in this repo (server + extension). pi core's
  "cannot continue from a dangling tool_use" is a fixed constraint we design
  around, not something we patch here.
- The web frontend's own queue/stop-midway behaviour (covered by the hardening
  brief + ADR 0002).

## Open Questions

1. **Observer transport.** The bridge today is built so the CLI process RUNS the
   agent and forwards events UP to the server. For observer mode the data flow is
   the OPPOSITE: the server must push its live run's events DOWN to the observing
   CLI for display. Does the existing `cli_*` protocol + `onEvent` fan-out cover
   this, or is a new server->CLI event channel (a `server_event` / observer
   subscription message) needed? (Likely: extend the protocol so a registered CLI
   can receive the server session's broadcast events.)
2. **How the CLI renders observed turns without a local agent loop.** The CLI's
   own pi agent is idle (dangling tool_use). Can the extension inject the observed
   assistant/tool messages into the local session view via `appendEntry` /
   message rendering WITHOUT driving the local agent loop, and does that stay
   coherent with the file the server is appending to? (Avoid double-append: the
   server owns the file; the CLI should render, not re-persist.)
3. **Takeover trigger UX.** Command (`/remote-takeover`), or auto-offer on first
   user input while observing ("this session is running in the web frontend; take
   over?"), or both? Default should NOT silently take over (that is today's bug).
4. **Idle-vs-streaming race at join.** `isStreaming` can flip between the CLI
   deciding to attach and the server processing the register. Decide the
   authoritative check point (server-side at `registerCliSession`) and the
   behaviour if the run ends exactly during attach (fall back to driver).
5. **Multiple observers + the web client.** While the CLI observes, the web
   client is presumably still attached. Confirm the server fan-out already
   tolerates N observers on one owned session and that the CLI is just one more
   client in `tracked.clients`.

## Sequencing (dependency order for the slicer)

1. **Foundation:** depends on the hardening brief's fake-LLM gate being in place
   (so the multi-process behaviour is testable). If that is not yet landed, the
   first task wires the minimal gate needed to drive a "join mid-tool-call"
   scenario.
2. **Server observer attach (blocks the rest):** change `registerCliSession()`
   so a streaming `server` session is NOT disposed; register the CLI as an
   observer; add the server->CLI event channel if OQ1 requires it. RED test:
   join mid-tool-call -> tool completes + result persisted (today: killed).
3. **Extension observer rendering:** working indicator from forwarded
   tool events + render the observed result/assistant turn; "observing vs
   driving" indicator. Depends on 2.
4. **Explicit takeover:** wire a deliberate takeover path (command/offer) onto
   the existing `takeOver()`/`session_interrupted` machinery. Depends on 2.
