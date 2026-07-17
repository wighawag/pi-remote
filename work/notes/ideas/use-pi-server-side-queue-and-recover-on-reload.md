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

This is the actual cause of all the session's "messages I didn't send / activity I couldn't see" confusion: a second client (pi CLI) on the same session, feeding the same loop, with wherever failing to sync the other client's messages. NOT a separate agent, NOT (for the interleaving) the reload-queue path.

### DEEPER ROOT CAUSE — a FORKED conversation DAG with no shared HEAD (confirmed by parentId tracing)

Further investigation corrected the "wherever just doesn't render the other client's messages" framing — it is deeper and explains why BOTH frontends (wherever AND the pi CLI via `/resume`) skip the sentinel. The pi session is a TREE linked by `parentId`, not a linear log. Tracing the records:

- The CLI sentinel (`id=0dd11bfb`) has `parentId=3ba59e8e` — an assistant message from ~07:51 (an HOUR earlier, back in the Gate investigation).
- The next wherever message (`id=7adb7944`, "Message sent…") has `parentId=ca9b3e5e` — the recent "Baseline captured" node (~09:00).
- So the two messages are SIBLINGS on DIVERGENT branches: the conversation DAG FORKED. The sentinel even got its own assistant reply (`id=40f703ca`) on its branch — it was answered, just on a branch the other client never walks.

Mechanism: **each frontend, when it sends a message, sets `parentId` to the last node THAT CLIENT had loaded/rendered — not the session's true latest leaf.** The pi CLI's `/resume` loaded the session but did NOT follow-on messages that arrived after the resume (the user's own observation), so its "latest" pointer was STALE (`3ba59e8e`); it parented the sentinel there, forking a sibling branch an hour back. wherever, with its own newer pointer, extended a DIFFERENT branch. On any later load/resume each client walks ITS OWN branch's lineage, so the other branch's messages are structurally OFF-PATH — not filtered, not flagged, just not on the walked lineage. Whichever branch you resume determines what you can see.

The records are otherwise byte-identical (same keys, same `role:user` shape) — there is NO per-message field distinguishing a skipped message; the discriminator is PURELY the `parentId` branch topology.

### THE FIRST CAUSE — one client's HEAD FROZE at 07:51 and never followed on (the sentinel is a REPEAT symptom)

Mapping EVERY user message to its parent's timestamp shows the fork is NOT a `/fork` (never invoked) and NOT the steer/queue path (the agent was IDLE when both anomalous messages were sent). It is a **client follow-on / stream desync**: one client stayed connected enough to SEND but STOPPED advancing its HEAD as new messages appended, so it kept parenting new messages to a stale node.

Evidence — nearly every user message parents to an assistant node from ~1-3 min earlier (healthy: HEAD current). EXACTLY TWO anomalies, and they share ONE parent:
- `08:13:49` “well I would like to know where this gate review” → parent `3ba59e8e` (**07:51:11**, 22 min stale).
- `08:59:58` SENTINEL (from the pi CLI) → parent `3ba59e8e` (**07:51:11**, 68 min stale).

The message just BEFORE the first anomaly (`07:49:48`) parented to `07:49:45` (current). So between 07:49 and 08:13 ONE client's HEAD froze at `3ba59e8e` (07:51) and never moved. It sent BOTH the 08:13 message and the 08:59 sentinel from that frozen HEAD. `3ba59e8e` is the ONLY branch point in the whole session, with exactly those two children. The OTHER client (the one the agent was actively streaming replies to) kept its HEAD current throughout, so its lineage became the trunk (Branch A), and the frozen client's two messages became the divergent branch.

What happened at ~07:51: a dense burst of assistant+toolResult records (the session-file grepping during the Gate investigation). The frozen client appears to have stopped CONSUMING new session events right after `3ba59e8e` while remaining able to send — a follow-on/stream break, not a full disconnect (a full disconnect+`removeClient` would not freeze a send-capable HEAD). So:
- The sentinel (the SECOND fork) is NOT an independent bug — it is the SAME frozen-HEAD client from the FIRST fork (08:13) sending again 46 min later, still pinned to 07:51.
- The CLI `/resume` later showing the message-but-not-the-sentinel is consistent: resuming walks ONE branch's lineage; the frozen-client branch is off the trunk.

So the ORIGINATING defect to fix is: **a client must not keep a frozen HEAD while still able to send.** When follow-on stops (stream desync, missed events, a half-open socket), the client must either (a) reconcile its HEAD to the session's actual latest leaf before allowing a send, or (b) be told it is stale and re-sync. Pinning `parentId` to a stale HEAD is what manufactures the unintended fork. (Distinct from the WANTED `/fork` feature — that is an explicit user action; this is an accidental fork from desync.)

### The REAL fix (supersedes "render the other client's messages")

Clients must converge on a shared HEAD before appending. Options, best first:
- **(a) Parent to the session's ACTUAL current leaf at send time** — re-read the session's latest leaf (server-authoritative) when composing `parentId`, so concurrent clients linearize instead of forking. The server already sees every appended record; it (not the client's stale view) should assign the parent.
- **(b) Detect divergence + merge/linearize** — if a client's known-latest is no longer the leaf, reconcile before appending.
- **(c) At minimum, render ALL branches** so an off-branch message is never silently invisible (and `/resume` must follow-on post-resume arrivals, not freeze its HEAD).
This sits alongside the server-side-queue work above; both are facets of "multiple clients on one live session must stay coherent."

### Additional fix implied by the confirmed root cause

Beyond the queue work above, wherever must **render ALL user messages on the session, regardless of which client sent them** — subscribe to the session's message stream (the server already sees every appended user message) and display messages authored by other clients (CLI or another browser), so a multi-client session is coherent and the user is never surprised by invisible turns. Tie this to the existing `takeOver`/`session_interrupted` multi-client machinery (`server/src/index.ts` / `session-pool.ts`).

### STILL OPEN (left for now, do not assume resolved)

- Exactly HOW the user's messages reached the running loop across reload(s): server-side steer-queue is the strong hypothesis but was NOT proven from the log (the delivery-mode field isn't persisted). Whether any reload actually dropped or duplicated a queued message in this specific session is unconfirmed.
- Whether the pi-remote frontend ever showed a transient “queued” state that was then lost on reconnect (UI-side), vs the message going straight to the server queue. Not reproduced.
- The harness/job-record side: `harness: "pi"` recorded `adapter: "null"` with no `harness.session` pointer in the job-record JSON (the session FILE exists at the predictable path above, but the record doesn't point to it). Tracked separately in agent-runner `work/observations/harness-pi-resolves-to-null-adapter-in-job-record.md`.

## Related: the INTENTIONAL fork feature (`docs/FORK_ANALYSIS.md`)

This note is about an ACCIDENTAL fork (frozen-HEAD desync). pi-remote ALSO has a planned/partially-implemented INTENTIONAL fork feature — edit-a-past-message → branch the session, plus a forks-as-forks UI — documented in `docs/FORK_ANALYSIS.md`. They MUST be implemented with shared foundations (cross-referenced there too):

- **Shared seam — HEAD reconciliation before send.** The fix here (“reconcile a client's HEAD to the session's actual latest leaf, or mark it stale, before allowing a send”) is the SAME machinery that makes an intentional fork land on the chosen node. Build it once; both consume it.
- **Shared seam — branch-aware rendering + `/resume` follow-on.** Rendering branches AS branches (and making `/resume` follow post-resume arrivals) is BOTH the feature's UI and the observability safety-net that stops an accidental fork from ever being silently invisible again.
- **`FORK_ANALYSIS.md` §4 “Bug Analysis” Cause 2 & 3** (CLI re-init race / disconnect; `clientId`-changed re-registration during `session_created`) are the SAME failure-mode family as the frozen-HEAD desync diagnosed here — our forensics (one client sending from a 68-min-stale node) are a concrete reproduction.
- **Distinct intent, must not be conflated:** `/fork` is an explicit user action (wanted); the desync fork is an accident (a bug). The feature must NOT ship without closing the accidental path, or unintended forks masquerade as intended ones.

## THIRD, DISTINCT MECHANISM — local queue auto-fires as `steer` MID-TURN because `isStreaming` drops on a slow tool step (CONFIRMED by a failing test, 2026-06-21)

The two mechanisms above are about RELOAD/RECONNECT visibility and MULTI-CLIENT
HEAD coherence. This third one is independent: it reproduces with a SINGLE
client, NO reload, NO second client. It is the most likely cause of the
user-reported "pi stops midway".

### The chain (all traced in the real code)

1. A multi-step pi turn (assistant -> tool -> assistant) emits an INTERMEDIATE
   `agent_end` at the assistant->tool boundary, WITHIN one user turn.
2. The client debounces that `agent_end` by only **300ms** before flipping
   `isStreaming` -> false (`client/src/client.ts`, `case 'agent_end'`: a
   `setTimeout(..., 300)`; `agent_start`/`tool_start` cancel it).
3. If the next step (`tool_start`/`agent_start`) is delayed **> 300ms** (a slow
   tool, model latency, a brief relay stall), the debounce fires and
   `isStreaming` goes **false MID-TURN**.
4. The frontend queue auto-sends on that signal
   (`web/src/lib/components/ChatInput.svelte`:
   `$effect(() => { if (!streaming && queuedText) sendMessage(queuedText); })`).
5. The server delivers a mid-stream message as `steer`
   (`server/src/index.ts` `case 'message'`: `pool.isStreaming(...) ? 'steer' : undefined`
   -> `agentSession.sendUserMessage(text, { deliverAs: 'steer' })`), INJECTING it
   into the still-running turn and redirecting pi. To the user: pi stopped midway.

### Root cause (one sentence)

`isStreaming` means "a stream is momentarily active", but the queue needs
"the user's TURN has fully settled". Those two differ exactly at tool boundaries
and slow steps, and the queue drains on the wrong one.

### Captured evidence (a RED test against the real reducer)

`work/ideas/use-pi-server-side-queue-and-recover-on-reload/queue-mid-turn-steer.test.ts` drives the real
`WhereverClient` reducer with fake timers and a scripted stream:
`agent_start -> message_update -> agent_end -> [advance 600ms] -> tool_start`.
It asserts `isStreaming` stays `true` across the gap (the turn is not over).
TODAY THIS FAILS (`expected false to be true`), proving the mechanism
deterministically. A control test with a <300ms gap passes (the debounce is fine
for fast steps). It is kept as EVIDENCE (not wired into the build); see
`work/ideas/use-pi-server-side-queue-and-recover-on-reload/README.md` to run it.

### The fix (aligns with the server-queue work above)

- **Drain the queue off a "turn settled" signal, not `isStreaming`.** The
  authoritative signal is pi's server-side run/queue state (the `queue_update`
  event + run lifecycle), which already distinguishes "between tool steps of one
  turn" from "turn complete". This is the SAME shift advocated above (make the
  server-side queue the source of truth) - so a single fix closes both.
- **Until then (defensive):** never let the LOCAL queue auto-send while a turn is
  in flight at the SERVER; gate the auto-send on a server-confirmed idle, or
  lengthen/replace the 300ms `agent_end` debounce with a real "turn ended" event
  rather than a heuristic timeout. (A heuristic timeout cannot be correct: any
  tool slower than the timeout reproduces the bug.)
- **Rewrite implication (for the brief):** the new protocol should forward an
  explicit run-idle / queue-state signal distinct from stream-activity, so
  neither the queue nor the UI has to guess from `isStreaming` + a magic-number
  debounce. This is a concrete, small architectural improvement, not a
  from-scratch necessity.

### RESOLVED: which pi signal means "user request complete, safe to drain queue" (traced in the agent loop, 2026-06-21)

Traced `@earendil-works/pi-agent-core/dist/agent-loop.js`. The event semantics
are the OPPOSITE of what the naming suggests, and this corrects the fix:

- **`agent_start` / `agent_end` wrap the WHOLE agent loop** (one user request),
  per the SDK type docs ("Fired when an agent loop starts/ends").
- **`turn_start` / `turn_end` fire PER STEP** inside the loop (`turnIndex`
  increments; `turn_end` carries `{message, toolResults}` for that step). So
  `turn_end` is NOT "user turn complete" - it is "one assistant+tool step done".
  Do NOT drain the queue on `turn_end`.
- **`agent_end` is emitted at MULTIPLE points**: inside the outer
  `while (true)` loop when the model stops (line ~151) AND at the final `break`
  (line ~166). After an in-loop `agent_end`, the loop RE-CHECKS the server-side
  queue (`getSteeringMessages()` / `getFollowUpMessages()`); if a steer/follow-up
  is queued it CONTINUES (more events follow). THIS is why wherever's client
  added the 300ms `agent_end` debounce - and why the debounce is unfixable as a
  timeout: the "is there more?" answer is the server-side QUEUE, not elapsed time.
- **Therefore the authoritative signal = `agent_end` reached with an EMPTY
  server-side queue.** pi already knows this and broadcasts queue state via the
  `queue_update` event (`_emitQueueUpdate` in agent-session.js). The correct fix:
  the server forwards `queue_update`; the client drains its local queue only when
  the run is idle AND pi's server-side queue is empty - never on `isStreaming`
  going false, and never on a timeout. (This also subsumes the steer/follow-up
  distinction: a mid-stream send should go to pi's queue as `followUp` so it runs
  as a NEW request after `agent_end`, not as a `steer` that redirects the
  in-flight one - which is the actual "stops midway" symptom.)

So OQ1 in the brief is ANSWERED: wherever does NOT need to synthesize a turn
lifecycle. It must FORWARD pi's existing `queue_update` and gate the queue on
run-idle + empty-server-queue. This is a small protocol addition (one server
message) + a client reducer change, not an architectural rewrite.

## Pointers

- Server queue + event: `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`
  (`_steeringMessages`/`_followUpMessages`/`_emitQueueUpdate`/`sendUserMessage`/`_queueSteer`/`_queueFollowUp`).
- wherever wiring: `server/src/index.ts` (`case 'message'`, `case 'abort'`),
  `server/src/session-pool.ts` (`sendUserMessage`, `isStreaming`, event forwarding via `setupEventListeners`/`onEvent`),
  `server/src/protocol.ts` (add/confirm a `queue_update` ServerMessage to the client).
- Frontend: `web/src/lib/components/ChatInput.svelte` (`queuedText`, the auto-send `$effect`, `handleUnqueue`),
  `web/src/lib/wherever.ts`, `web/src/lib/session-store.ts`.
