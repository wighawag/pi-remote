# Steer by default on an explicit submit; remove the local auto-drain queue

**Status:** accepted (supersedes 0002)

A message submitted in the web composer WHILE the agent is streaming now steers the agent immediately, matching pi's default. The client calls `sendMessage(...)` on submit, and the server (unchanged) turns a mid-stream `message` into a `steer` (`server/src/index.ts` `case 'message'`: `pool.isStreaming(...) ? 'steer' : undefined` -> `agentSession.sendUserMessage(text, { deliverAs: 'steer' })`). There is no local `queuedText` that waits for the whole turn to resolve, and no `isStreaming`-driven auto-drain. The primary button reads "Steer" while streaming, and the surrounding copy uses pi's language ("Agent is working, Steer to interrupt").

## Reconciliation with ADR 0002 ("stops midway")

ADR 0002 diagnosed a real "pi stops midway" bug and proposed the OPPOSITE direction (mid-stream sends should be `followUp`, drained only on run-idle + empty server queue). That diagnosis is not wrong, but its framing conflated two different things:

- The actual defect was UNINTENTIONAL, AUTO-FIRED steering. The client kept a local `queuedText` and auto-sent it the moment `isStreaming` flipped false, which it inferred from a flaky 300ms `agent_end` debounce. A multi-step turn briefly flips `isStreaming` false at tool boundaries, so the queued message fired MID-TURN as a steer and redirected the agent when the user never asked it to. The bug was the guessing-and-auto-firing, not steering itself.
- pi's own default IS steer, and it is correct BECAUSE it is driven by an EXPLICIT user submit (interactive-mode.ts: Enter while streaming calls `session.prompt(text, { streamingBehavior: "steer" })`). An explicit steer at a step boundary is the intended feature, not a bug.

So the correct model is pi's: an explicit user submit steers immediately; there is no auto-draining local queue that guesses when to fire. This decision REMOVES the "stops midway" mechanism (the `isStreaming`-driven auto-send is deleted) rather than contradicting ADR 0002. With no local queue and no timer-based auto-drain, the specific chain ADR 0002 traced (intermediate `agent_end` -> 300ms debounce -> `isStreaming` false mid-turn -> auto-send as steer) can no longer occur: nothing auto-sends.

The remaining `isStreaming` / 300ms `agent_end` debounce in `client/src/client.ts` stays as-is for its OTHER jobs (enabling/disabling Abort, driving the "working" affordance, finalizing streaming tails). It no longer drives any message delivery, so its imprecision at tool boundaries is now cosmetic, not a redirect hazard.

## Follow-up (pi's Alt+Enter) is the explicit opt-in, never the default

pi keeps a "wait until the agent finishes" mode as an explicit, opt-in `followUp` (Alt+Enter, rendered "Follow-up: ..."). If wherever exposes a "wait" affordance later, it must be that: explicit and opt-in, never the default and never auto-fired. The decision helper (`web/src/lib/core/compose-send.ts`) already carries `deliverAs: 'steer' | 'followUp'` on its `send` outcome so this can be added without reworking the submit seam. It is deferred for now (out of scope for this change).

## Consequences

- `web/src/lib/components/ChatInput.svelte` no longer holds `queuedText` / `queuedTextBackup`, the auto-send `$effect`, the "show queued text" `$effect`, or the `handleUnqueue` / "Unqueue" button. The composer stays live while the agent streams; submitting steers now.
- Submit routes through a pure, unit-tested `decideComposeSend(...)` helper. A mid-stream connected submit resolves to `{action:'send', deliverAs:'steer'}` (immediate). The only non-send outcomes are genuine blocks (no session / read-only / disconnected / agent-pending), which keep the user's text intact and surface a clear state instead of silently swallowing it.
- Hard-won safety is preserved: `sendMessage(...)` still returns `false` on a dropped/half-open send and the composer keeps the text; per-session draft persistence is unchanged; disconnected / resyncing / agent-pending still surface clear, recoverable states rather than swallowing a message.
- The server side (steer wiring, server-side queue, `queue_update`) is untouched: it already delivered mid-stream messages as steer. The broader "render pi's server-side queue as the source of truth + recover on reload" direction (`work/ideas/use-pi-server-side-queue-and-recover-on-reload.md`) remains open and is compatible: this change removes the client-only queue that competed with it.

## Tests (the gate)

- `web/src/lib/core/compose-send.test.ts`: a mid-stream connected submit resolves to an immediate steer, never a queue/wait; blocks keep text.
- `client/test/mid-stream-steer.test.ts`: driving the real client + fake WS, a mid-stream `sendMessage` hands a `message` frame to the socket NOW and commits the optimistic echo; a disconnected mid-stream send returns false with no phantom echo.
- `server/test/steer-mid-stream.test.ts`: end-to-end against the fake LLM, a second message submitted mid-turn is accepted as a steer into the SAME session (no error, no forked session).
