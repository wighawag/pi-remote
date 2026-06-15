---
title: Use pi's SERVER-SIDE message queue (steer/followUp) as the source of truth, render it in the UI, and recover it on reload/reconnect — and on unqueue restore the text into the input
slug: use-pi-server-side-queue-and-recover-on-reload
type: idea
status: incubating
---

# Frontend should use pi's server-side queue, not its own ephemeral one

> Captured 2026-06-15 while diagnosing a confusing `drive-backlog` session where
> messages sent mid-stream interleaved with a long-running autonomous agent loop,
> and a reload made queued/in-flight state invisible. The mechanism was traced
> through the code (see "Evidence" below). The agent loop itself behaved correctly;
> the gap is purely the dashboard's queue handling + observability.

## The problem

The web frontend keeps its OWN ephemeral queue in component state and does not
recover it across reload/reconnect, while pi ALREADY maintains an authoritative
server-side queue. So:

- A message typed while the agent is streaming is held in `ChatInput.svelte`'s
  `queuedText` (`$state`, in-memory only) and auto-sent when streaming stops.
- On reload, `queuedText` is LOST from the UI. Depending on timing the message
  either (a) was already delivered to pi's server-side queue and will execute
  with NO visible trace in the reconnected UI, or (b) was still only in
  `queuedText` and is silently dropped. Both are bad: invisible execution, or
  silent loss.
- The UI cannot show "what is queued right now" after a reconnect, nor that the
  agent is mid-turn having just consumed a steered message — which is exactly the
  state that made a long autonomous loop look like a mysterious second agent.

## Evidence (from the code — confirmed, not assumed)

- **pi keeps the queue SERVER-SIDE.** `@earendil-works/pi-coding-agent`'s
  `AgentSession` (`dist/core/agent-session.js`) holds `_steeringMessages`,
  `_followUpMessages`, `_pendingNextTurnMessages`, delivers via `agent.steer()` /
  `agent.followUp()` when `isStreaming`, and **emits a `queue_update` event**
  (`_emitQueueUpdate()` → `{ type: "queue_update", steering: [...], followUp: [...] }`).
  So the server already broadcasts authoritative live queue state.
- **wherever already routes through it.** `server/src/index.ts` `case 'message'`:
  `const streaming = pool.isStreaming(...); pool.sendUserMessage(..., streaming ? 'steer' : undefined)`,
  and `session-pool.ts` `sendUserMessage(...)` calls
  `agentSession.sendUserMessage(text, { deliverAs: streamingBehavior })`. So the
  server-side queue IS being fed — the frontend just isn't using its STATE as the
  source of truth.
- **The frontend queue is ephemeral + unrecovered.** `web/src/lib/components/ChatInput.svelte`:
  `let queuedText = $state<string|null>(null)` with an `$effect` that auto-sends on
  `!streaming`. It is not persisted and not re-derived from the server on reconnect.
  (Contrast: `enter-to-send` IS persisted in `localStorage` — the pattern exists,
  it's just not applied to the queue.)
- **The agent survives disconnect (correct, keep it).** `ws.on('close')` only
  `removeClient`s; `scheduleIdleCheck` arms the destroy timer ONLY when
  `tracked.isIdle` — so a streaming agent with zero clients keeps running headless.
  That resilience is GOOD; the frontend just needs to reflect it on reconnect.

## The change

1. **Make pi's server-side queue the source of truth.** Render the composer's
   "queued" state from the server's `queue_update` events (steering + followUp
   lists), not from a local-only `queuedText`. Send mid-stream messages with the
   intended `deliverAs` (steer vs followUp — expose the choice if useful) and let
   the server own the queue.
2. **Recover on reload/reconnect.** On (re)connect to a session, request/replay
   the current `queue_update` so the UI immediately shows what is queued — no lost
   queue, no invisible in-flight message. Also surface "agent is mid-turn"
   (`isStreaming`) so a reconnect to a still-running autonomous loop is legible,
   not mistaken for a phantom.
3. **Unqueue restores the text to the input.** When the user unqueues a pending
   message, remove it from pi's server-side queue (the SDK exposes the queue +
   emits `queue_update` on change) AND put the text back into the composer input
   so it can be edited or resent — never silently dropped. (`handleUnqueue` in
   `ChatInput.svelte` already restores into the textarea for the LOCAL queue;
   extend it to drive the SERVER queue.)
4. **Show queue position/labels** from the server lists so the user sees order +
   whether each item is a steer (injected mid-turn) or a followUp (next turn).

## Why it matters

It removes a whole class of confusion (invisible in-flight messages, lost queue on
reload) by deferring to the authoritative server-side queue pi already maintains
and broadcasts. The dashboard becomes an honest live view of the agent's real
queue + run state across reconnects — especially important when the session is a
long-running autonomous loop (`drive-backlog`/`run`) the user dips in and out of.

## Forensic detail from the session that surfaced this (2026-06-15, NOT fully root-caused — kept open)

The confusion that triggered this note is only PARTLY explained; recorded here verbatim so it can be finished later. What is VERIFIED vs still OPEN:

### Session files involved (all under `~/.pi/agent/sessions/`)

- **The conductor + this conversation (ONE file):**
  `~/.pi/agent/sessions/--home-wighawag-dev-github-wighawag-agent-runner--/2026-06-14T22-11-28-534Z_019ec830-9896-75ae-bb40-61ac1a1a67f1.jsonl`
  (~1.4M; first user message = `/drive-backlog with --review`; last activity ~08:48+). This single session is BOTH the `drive-backlog` conductor AND the slice-review chat.
- **A separate short session** that created the `goal-driven-bounded-loop` idea (commit `9b46e9f`/`8750deb`):
  `~/.pi/agent/sessions/--home-wighawag-dev-github-wighawag-agent-runner--/2026-06-15T06-02-27-721Z_019ec9df-cc09-7c6f-806c-25dc32a88ca3.jsonl` (34 lines).
- **Per-slice BUILD agents** (one dir each):
  `~/.pi/agent/sessions/--home-wighawag-.agent-runner-work-github-com__wighawag__agent-runner__<slug>--/<slug>-<id>.jsonl`
  (e.g. `…__install-ci-close-job-workflow--/install-ci-close-job-workflow-mqevb04j-592ujb.jsonl`).
- **Per-slice GATE-2 review agents** (fresh-gate tip worktrees):
  `~/.pi/agent/sessions/--tmp-agent-runner-fresh-gate-<rand>-tip--/<slug>-review-<id>.jsonl`
  (e.g. `--tmp-agent-runner-fresh-gate-pgFCgs-tip--/install-ci-close-job-workflow-review-mqevwr88-tc62qz.jsonl`). VERIFIED: these contain ZERO `gh pr` calls — Gate-2 emits a verdict to the runner, never touches the PR.

### VERIFIED facts

- The conductor session ran **~7.5 h UNATTENDED** (user msg `22:13:37` “Yes propose + gate 3” → next user msg `05:41:53`). Most Gate-3 merges happened in that window with no human present (so “invisible” simply because no chat was open), e.g. PR #127 merged 06:20, #128 06:42, #129 07:01.
- Counting ACTUAL tool calls in the conductor `.jsonl` (parsed JSON, not prose matches): **9 real `bash` `gh pr merge` toolCalls, 6 `gh pr comment`, 0 `Subagent`/`Task` toolCalls.** So Gate-3 + merges were done by THIS session's own bash tool, not a fork or a subagent.
- On return (05:41+), the loop was still running; the user's later messages interleaved with ongoing tool calls (activity log shows each user msg followed within seconds by an assistant turn that then continues tool work) — consistent with pi's server-side steer/followUp queue injecting messages at turn boundaries of the SINGLE running agent.
- `deliverAs`/`source`/`streamingBehavior` are NOT persisted on the user-message entries in the `.jsonl` (runtime-only delivery hints), so the steer-vs-normal distinction could NOT be read back from the log directly — inferred from timestamps + the user's own “this message is queued” note (06:18:14).

### ROOT CAUSE — CONFIRMED LIVE (2026-06-15, multi-client on one session)

A controlled experiment proved the interleaving cause. With the SAME session open in BOTH the pi CLI and the wherever web client, a unique sentinel was sent from the CLI:

```
08:57:47Z  (wherever)  "Well wonder if we could try the ci install-ci..."
08:59:58Z  (pi CLI)    "SENTINEL-CLI-7Q2 from the cli frontend, ignore for content"
09:00:40Z  (wherever)  "Message sent, re install+ci tests..."
```

The CLI sentinel **landed in the SAME session `.jsonl` as a `user` message, interleaved between two wherever messages** — AND the wherever-attached agent turn-stream **never surfaced it** (no response turn; invisible in the wherever view). So:

- **Both frontends attach to the ONE server-side `AgentSession`** (`tracked.clients` is a Set — multi-client per session is a supported state; `takeOver`/`session_interrupted` exist precisely for it). A message from EITHER client is appended to the one session and fed to the one agent loop.
- **wherever does NOT follow-on / render messages that arrive from the OTHER client.** The CLI message drove the shared loop but was invisible in wherever — the "wherever pi-extension doesn't follow new messages" bug.

This is the actual cause of all the session's "messages I didn't send / activity I couldn't see" confusion: a second client (pi CLI) on the same session, feeding the same loop, with wherever failing to sync the other client's messages. NOT a fork, NOT a separate agent, NOT (for the interleaving) the reload-queue path.

### Additional fix implied by the confirmed root cause

Beyond the queue work above, wherever must **render ALL user messages on the session, regardless of which client sent them** — subscribe to the session's message stream (the server already sees every appended user message) and display messages authored by other clients (CLI or another browser), so a multi-client session is coherent and the user is never surprised by invisible turns. Tie this to the existing `takeOver`/`session_interrupted` multi-client machinery (`server/src/index.ts` / `session-pool.ts`).

### STILL OPEN (left for now, do not assume resolved)

- Exactly HOW the user's messages reached the running loop across reload(s): server-side steer-queue is the strong hypothesis but was NOT proven from the log (the delivery-mode field isn't persisted). Whether any reload actually dropped or duplicated a queued message in this specific session is unconfirmed.
- Whether the pi-remote frontend ever showed a transient “queued” state that was then lost on reconnect (UI-side), vs the message going straight to the server queue. Not reproduced.
- The harness/job-record side: `harness: "pi"` recorded `adapter: "null"` with no `harness.session` pointer in the job-record JSON (the session FILE exists at the predictable path above, but the record doesn't point to it). Tracked separately in agent-runner `work/observations/harness-pi-resolves-to-null-adapter-in-job-record.md`.

## Pointers

- Server queue + event: `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`
  (`_steeringMessages`/`_followUpMessages`/`_emitQueueUpdate`/`sendUserMessage`/`_queueSteer`/`_queueFollowUp`).
- wherever wiring: `server/src/index.ts` (`case 'message'`, `case 'abort'`),
  `server/src/session-pool.ts` (`sendUserMessage`, `isStreaming`, event forwarding via `setupEventListeners`/`onEvent`),
  `server/src/protocol.ts` (add/confirm a `queue_update` ServerMessage to the client).
- Frontend: `web/src/lib/components/ChatInput.svelte` (`queuedText`, the auto-send `$effect`, `handleUnqueue`),
  `web/src/lib/wherever.ts`, `web/src/lib/session-store.ts`.
