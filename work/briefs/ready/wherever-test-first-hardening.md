---
title: Wherever test-first hardening with a deterministic fake-LLM gate (TDD + Playwright, dorfl-driven)
slug: wherever-test-first-hardening
needsAnswers: true
---

> Launch snapshot - records intent at creation, NOT maintained. Current truth:
> the code + `docs/adr/` once written; remaining work: the tasks sliced from this
> brief. Evidence backing the technical claims lives in `work/ideas/use-pi-server-side-queue-and-recover-on-reload/`
> and `work/ideas/use-pi-server-side-queue-and-recover-on-reload.md`.

## Problem Statement

Wherever works, but we keep hitting the same class of bug and have **no
confidence fixing anything** because a change in one place silently breaks
another. The root cause is structural, not architectural: there are **zero
automated tests** across `web`, `server`, `client`, `extension`. Every regression
is found by hand, in a real browser, often on mobile, often intermittently.

The bugs cluster in two layers:

1. **Protocol / session-lifecycle / queue state** (the "other things break" fear):
   messages sent mid-stream redirect the agent ("pi stops midway"), queued
   messages get lost on unqueue or reload, multi-client sessions fork silently,
   reconnect/resume mishandles in-flight turns.
2. **Frontend-only** rendering/UX: stale-on-first-load (prerender + service
   worker), Firefox-Android reload-on-resume, long-session load time.

We considered a full from-scratch rewrite. Investigation (see Evidence) shows the
**architecture is sound; it is just not seam-for-testing**, and the agent turn is
not injectable, so nothing can be tested deterministically. The real need is a
**deterministic test substrate + a gate that enforces it**, then test-first fixes
for the known bugs - run as a rigid claim/build/gate/integrate loop under
`agent-runner` (dorfl).

## Solution

From the developer's perspective:

- There is a **fake-LLM server** that speaks the real Anthropic-Messages SSE API.
  The real `pi` harness talks to it believing it is a model, so agent turns are
  **deterministic, free, offline**, and we can script timing and failures
  (truncation, slow tool steps) that a code-level mock never could. (Proven:
  `work/ideas/use-pi-server-side-queue-and-recover-on-reload/{fake-llm-server,harness,round-trip.test}.ts`.)
- There is a **per-package `test` script** and the acceptance gate is
  `pnpm -r build && pnpm -r test && playwright test` - all deterministic and
  parallel-safe (each worktree picks its own free port; proven in the spike).
- **Every known recurring bug is a failing test first**, then fixed, then green.
  Confidence comes from the gate, not from manual re-checking.
- The work is sliced and run by **dorfl**: each fix is a claimed task that cannot
  land unless build + vitest + Playwright are green, so TDD is enforced
  structurally, not by discipline.
- We do **not** rewrite the Svelte UI from scratch (it is clean Svelte 5, 0
  errors). We rewrite/refactor only the seams that block testing: the
  agent/transport seam and the per-turn lifecycle signal.

## User Stories

1. As a developer, I want a fake Anthropic-Messages LLM server, so that agent
   turns in tests are deterministic, free, and offline.
2. As a developer, I want the fake LLM driven via an isolated
   `PI_CODING_AGENT_DIR` + `models.json` provider, so that tests never touch my
   real `~/.pi` and the real `createAgentSession` path is exercised unchanged.
3. As a developer, I want the fake LLM to support a `cut-midway` mode (destroy the
   SSE stream mid-response), so that I can reproduce transport truncation
   deterministically.
4. As a developer, I want the fake LLM to support an injected **tool call** in its
   reply, so that I can drive a real multi-step pi turn (assistant -> tool ->
   assistant) and test behaviour at tool boundaries.
5. As a developer, I want the fake LLM to support **scriptable timing** (delay
   before the next step), so that I can reproduce the >300ms tool-gap race.
6. As a developer, I want a vitest harness that boots the REAL wherever server
   against the fake LLM on an ephemeral port with a throwaway cwd, so that
   server-level integration tests are isolated and parallel-safe.
7. As a developer, I want a Playwright config that picks a free port per run, so
   that N dorfl worktrees can run the e2e gate concurrently without colliding on
   31415.
8. As a developer, I want one Playwright e2e test of the full stack (real browser
   -> built web bundle -> real server -> fake LLM) doing a streamed round-trip,
   so that the gate covers the real UI, not just the protocol.
9. As a developer, I want `pnpm -r test` to run all package vitest suites and a
   separate `playwright` script for the e2e gate, so that the acceptance gate is
   one command.
10. As a developer, I want the queue/UI to drain on pi's authoritative run-idle +
    empty-server-queue signal (forwarded `queue_update`), so that they stop
    guessing "is the request over?" from `isStreaming` + a 300ms debounce. (OQ1
    resolved: use pi's existing `queue_update`, do not invent a turn lifecycle.)
11. As a user, I want a message I queue while the agent works to be delivered
    only AFTER the current turn fully settles (never injected as a mid-turn
    `steer`), so that pi does not "stop midway" and switch to my queued message.
    (Reproduction: `work/ideas/use-pi-server-side-queue-and-recover-on-reload/queue-mid-turn-steer.test.ts`, currently
    RED.)
12. As a user, when I **unqueue** a pending message, I want its text restored into
    the input (editable, not sent, not lost). (See
    `docs/plan-fix-unqueue-loses-message.md`.)
13. As a user, I want the queue to survive reload/reconnect by rendering pi's
    authoritative server-side queue (`queue_update`), so that a queued or in-flight
    message is never invisible or silently dropped. (See
    `work/ideas/use-pi-server-side-queue-and-recover-on-reload.md`.)
14. As a user with the same session open in two clients (CLI + web), I want both
    clients to stay on one shared conversation HEAD, so that messages do not fork
    onto an invisible branch (the frozen-HEAD desync).
15. As a user, I want every user message on a session rendered regardless of which
    client sent it, so that a multi-client session is never surprising.
16. As a user, I want the first page load to never show a stale prerendered
    session list, so that I trust what I see. (See
    `docs/plan-fix-prerender-staleness.md`.)
17. As a Firefox-Android user, I want returning to the app after a screen lock to
    not trigger a slow full reload. (See
    `docs/plan-firefox-android-reload-on-resume.md`.)
18. As a user with long sessions, I want them to load quickly. (See
    `docs/plan-speed-up-long-session-load.md`.)
19. As a developer, I want the VS Code companion (which shares `@wherever-dev/client`)
    to benefit from the same reducer tests, so that fixing the client fixes both
    surfaces.
20. As a maintainer, I want each fix to ship behind the green gate via dorfl, so
    that no fix regresses another (the core confidence goal).

### Autonomy notes

- `humanOnly`: omitted. Once the open questions below are answered, the tasks are
  agent-buildable (deterministic gate, no human-only judgement in the fixes).
- `needsAnswers: true`: there are real open questions (below) about scope and the
  exact turn-lifecycle signal that must be resolved before auto-slicing, or the
  slicer will cut wrongly-shaped tasks (e.g. fixing the queue against the wrong
  signal).

## Implementation Decisions

- **Fake LLM is a SERVER, not a code seam.** A code-level mock can fake a reply;
  only a fake server can fake a truncated stream, a slow step, a malformed
  tool-call, a 500. It exercises the real SSE parser, retry logic, and event
  broadcasting. Enabler: pi's `PI_CODING_AGENT_DIR` env + the `models.json`
  provider schema `{ providers: { fake: { baseUrl, api: "anthropic-messages",
  apiKey, models:[{id}] } } }`. (Confirmed against the installed pi-ai and the
  existing `~/.pi/agent/models.json.localhost`.)
- **No production server code change is required to point pi at the fake.** The
  harness sets env + writes an isolated agent dir. (Proven.)
- **Run-idle + empty-queue seam (OQ1 RESOLVED).** pi's events were traced
  (`pi-agent-core/dist/agent-loop.js`): `agent_start`/`agent_end` wrap the WHOLE
  loop (one user request); `turn_start`/`turn_end` fire PER STEP (assistant +
  tool batch) and are NOT "user turn complete". `agent_end` is emitted at
  multiple points and the loop then re-checks pi's SERVER-SIDE queue
  (`getSteeringMessages`/`getFollowUpMessages`) to decide whether to continue -
  which is exactly why the client's 300ms `agent_end` debounce exists and why a
  timeout can never be correct. The authoritative "safe to drain the local queue"
  signal is therefore: the run is idle AND pi's server-side queue is empty,
  which pi already broadcasts via the `queue_update` event (`_emitQueueUpdate`).
  Fix = the server FORWARDS `queue_update` (one new server message); the client
  drains on run-idle + empty-server-queue, never on `isStreaming` or a timeout.
  A mid-stream send should enqueue as `followUp` (runs as a new request after
  `agent_end`), NOT `steer` (redirects the in-flight run = the "stops midway"
  symptom). No new turn lifecycle needs to be invented.
- **Queue source of truth = pi's server-side queue.** Align the queue fix with
  the existing idea: render `queue_update`, recover on reconnect, unqueue drives
  the server queue + restores text. One change closes stories 11-13.
- **Do not rewrite the UI from scratch.** Keep the Svelte 5 components; refactor
  only where the new protocol/lifecycle requires.
- **Gate shape:** `pnpm -r build && pnpm -r test && pnpm playwright`. Playwright
  and the server harness each pick a free port per run (parallel-safe). The
  `agent-runner` `verify` command maps to this.

## Testing Decisions

- **Three test levels:**
  - **Unit (reducer):** drive `WhereverClient.handleMessage` with scripted event
    streams + fake timers. Fast, zero network. This is where the queue/turn-
    lifecycle bugs are pinned (prior art: `queue-mid-turn-steer.test.ts`).
  - **Integration (server + fake LLM):** boot the real server, real
    `createAgentSession`, real HTTP to the fake. Tests multi-step turns, steer
    timing, truncation, reconnect. Prior art: `round-trip.test.ts` + `harness.ts`.
  - **E2E (Playwright):** real browser -> built web -> real server -> fake LLM,
    for the genuinely UI-level bugs (prerender staleness, mobile resume) and a
    smoke round-trip.
- **Test external behaviour, not internals:** assert "queued message delivered
  after turn settles / not as steer", "unqueue restores text", "first load shows
  fresh list" - never assert on private timer fields.
- **Every known bug becomes a RED test before its fix** (stories 11-18 each map to
  a `docs/plan-fix-*.md` or an evidence file).
- Evidence/prior art already in `work/ideas/use-pi-server-side-queue-and-recover-on-reload/` is the seed; slicing should
  promote those into real `client/test/` and `server/test/` suites with the
  `vitest` devDep + `"test"` script wired per package (deliberately reverted at
  spike time to keep the tree clean).

## Out of Scope

- A from-scratch UI rewrite (the UI is fine; this is hardening, not a redo).
- The intentional `/fork` feature (`docs/FORK_ANALYSIS.md`) - shares the HEAD-
  reconciliation seam (story 14) but is its own feature brief.
- agent-runner fleet-watch integration (`work/ideas/watch-agent-runner-fleet-sessions.md`).
- Speech/upload/marketing-site work unless a known bug there is added later.

## Further Notes

- The investigation that produced this brief lives on branch `spike/fake-llm-gate`
  (uncommitted) and in `work/ideas/use-pi-server-side-queue-and-recover-on-reload/`. Adopting it means moving the
  evidence tests into the packages and wiring the gate.
- Prerequisite before dorfl can drive this: pi-remote must adopt the agent-runner
  `work/` contract (it currently only has `work/ideas/`). That adoption is itself
  a small setup task.

## Open Questions (clear `needsAnswers` once answered)

1. ~~**Turn-lifecycle signal:**~~ RESOLVED 2026-06-21 (traced
   `pi-agent-core/dist/agent-loop.js`). pi exposes no single "user turn complete"
   event; `agent_end` fires multiple times and the loop re-checks the server-side
   queue. The signal to use is run-idle + empty server-side queue, which pi
   broadcasts via `queue_update`. The fix is: server FORWARDS `queue_update` (one
   new server message) + client drains on that. A small protocol addition, not a
   synthesized lifecycle. (See the idea file's "RESOLVED" section.)
2. **Scope of v1:** which surfaces are in the first pass - `web` + `server` +
   `client` only, or also `extension` (CLI bridge) and `vscode`? The bridge has
   its own queue/HEAD path.
3. **Parity bar to "trust it":** is "all known bugs green + gate enforced" the
   bar, or full feature parity with manual verification retired?
4. **Adopt the agent-runner contract now?** Scaffold `work/{tasks,briefs,...}` +
   register pi-remote with dorfl as the first task, or run this brief's fixes
   manually until the substrate exists?
5. **Playwright in the gate cost:** is `playwright install` + headless run
   acceptable on every dorfl worktree, or should e2e be a separate, less-frequent
   gate tier than vitest?
