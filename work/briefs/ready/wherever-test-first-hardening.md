---
title: Wherever test-first hardening with a deterministic fake-LLM gate (TDD + Playwright, dorfl-driven)
slug: wherever-test-first-hardening
---

> Launch snapshot - records intent at creation, NOT maintained. Current truth:
> the code + `docs/adr/`; remaining work: the tasks sliced from this brief.
> The durable decisions are recorded as ADRs: `docs/adr/0001-fake-llm-server-as-deterministic-test-substrate.md`
> and `docs/adr/0002-drain-queue-on-pi-queue-state-not-isstreaming.md`.
> Evidence backing the technical claims lives in
> `work/ideas/use-pi-server-side-queue-and-recover-on-reload/` (spike harness +
> tests) and `work/ideas/use-pi-server-side-queue-and-recover-on-reload.md`.

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
    guessing "is the request over?" from `isStreaming` + a 300ms debounce. (Per
    ADR 0002: use pi's existing `queue_update`, do not invent a turn lifecycle.)
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

- `humanOnly`: omitted. The fixes are agent-buildable (deterministic gate, no
  human-only judgement); the scope/sequencing decisions are recorded below.
- `needsAnswers`: omitted (cleared 2026-06-21). The questions that would have
  mis-shaped slicing are now Decisions of Record below: the turn/queue signal is
  resolved (ADR 0002), the test substrate is resolved (ADR 0001), and v1 scope /
  parity bar / contract-adoption / gate-tiering are decided. The remaining
  judgement (how far to push multi-client HEAD coherence) is bounded by
  Sequencing step 4 and may split into its own brief - it does not block the
  foundation or the queue fix.

## Implementation Decisions

- **Fake LLM is a SERVER, not a code seam (ADR 0001).** Only a fake server can
  reproduce a truncated stream / slow step / malformed tool-call / 500, and it
  exercises the real SSE parser, retry, and event broadcasting. Enabler: pi's
  `PI_CODING_AGENT_DIR` env + the `models.json` provider schema
  `{ providers: { fake: { baseUrl, api: "anthropic-messages", apiKey,
  models:[{id}] } } }`. No production server code change needed to wire it
  (proven by the spike harness).
- **Drain the queue on pi's run-idle + empty-queue, not `isStreaming` (ADR 0002).**
  Traced `pi-agent-core/dist/agent-loop.js`: `agent_start`/`agent_end` wrap the
  WHOLE loop; `turn_start`/`turn_end` fire PER STEP (not "user turn complete");
  `agent_end` is emitted at multiple points and the loop re-checks pi's
  server-side queue before continuing - which is why the 300ms `agent_end`
  debounce exists and why a timeout can't be correct. The fix: server FORWARDS
  pi's `queue_update` (handled by neither side today); the client drains only on
  run-idle + empty-server-queue; a mid-stream send enqueues as `followUp`, not
  `steer`. This same `queue_update` forwarding gives queue visibility/recovery on
  reconnect and unqueue-drives-the-server-queue, so one change closes stories
  10-13. (See `work/ideas/use-pi-server-side-queue-and-recover-on-reload.md`.)
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

- The investigation that produced this brief is committed on branch
  `spike/fake-llm-gate` (docs-only) and the runnable spike artifacts live in
  `work/ideas/use-pi-server-side-queue-and-recover-on-reload/`. Adopting them =
  Sequencing step 1 (promote into the packages + wire the gate).
- Decisions of Record + Sequencing (below) carry everything the slicer needs; the
  durable rationale is in `docs/adr/0001` and `docs/adr/0002`.

## Decisions of Record (resolved - these set the v1 boundary)

The questions that shape slicing are now answered (the durable ones are ADRs).
They are recorded here so the brief is self-contained and sliceable.

1. **Turn/queue signal - RESOLVED (ADR 0002).** Drain the local queue on pi's
   run-idle + empty-server-queue, forwarded via `queue_update`; mid-stream sends
   enqueue as `followUp`, not `steer`. No invented turn lifecycle. (Traced in
   `pi-agent-core/dist/agent-loop.js`; `queue_update` is currently handled by
   neither server nor client, so this is a clean additive change.)
2. **Test substrate - RESOLVED (ADR 0001).** Fake LLM server + isolated
   `PI_CODING_AGENT_DIR`, no production code change to wire it.
3. **v1 surface scope - DECIDED: `server` + `client` + `web`.** The bugs and the
   gate live here, and `client` is shared with `vscode` so fixing the reducer
   benefits both surfaces for free. `extension` (CLI bridge) and `vscode` are v2
   (their own queue/HEAD paths get their own tasks once the shared seam lands).
   Multi-client HEAD coherence (stories 14-15) is IN v1 only at the
   render-all-messages level; full HEAD reconciliation is its own task, shared
   with the `/fork` feature (Out of Scope).
4. **Parity bar - DECIDED: "known bugs green + gate enforced," NOT full parity.**
   The goal is confidence, not a rewrite. Manual verification is retired per-area
   only once that area has gate coverage; no big-bang cutover.
5. **Adopt the agent-runner contract - DECIDED: yes, as the FIRST task.** Scaffold
   `work/{tasks,briefs,...}` and register pi-remote with dorfl before any fix is
   sliced, so every subsequent fix lands behind the gate. (Until then, the
   foundation task below can be done by hand.)
6. **Playwright gate cost - DECIDED: two-tier gate.** `vitest` (unit + fake-LLM
   integration) runs on EVERY task/worktree; Playwright e2e is a SEPARATE,
   lighter-frequency tier (smoke + the genuinely UI-level bugs: prerender
   staleness, mobile resume). `verify` runs both; a fast inner loop can run
   vitest only. This keeps per-task cost low without losing real-browser cover.

## Sequencing (dependency order for the slicer)

This brief is mostly a dependency CHAIN at the start, then parallel fixes:

1. **Foundation (blocks everything):** adopt the `work/` contract + register with
   dorfl; promote the spike evidence into real `server/test/` + `client/test/`
   suites; add `vitest` devDep + `"test"` script per package; add the Playwright
   config (free-port-per-run) + one e2e smoke; wire `verify` = build + vitest +
   (tiered) playwright. After this, the gate is real and green on a no-op.
2. **Queue/stop-midway fix (depends on foundation):** forward `queue_update`
   (server + protocol + client reducer); drain on run-idle + empty-queue; send
   mid-stream as `followUp`; turn the RED `queue-mid-turn-steer` test green;
   unqueue restores text (story 12). Closes stories 10-13.
3. **Parallel known-bug fixes (each depends only on foundation):** prerender
   staleness (16), Firefox-Android resume (17), long-session load (18),
   render-all-messages multi-client (15). Each: RED test first, then green.
4. **Multi-client HEAD coherence (14):** larger; shares the reconciliation seam
   with `/fork`. May be deferred to its own brief if it grows.
