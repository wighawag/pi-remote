---
title: Conversation-mode hint latch can survive a turn when before_agent_start is skipped (mid-stream steer / early-return command)
date: 2026-07-25
status: open
relatedTask: conversation-mode-agent-signal
relatedAdr: 0004-conversation-mode-agent-signal-inline-extension-and-lockstep-hint
---

## What was observed

Follow-up from the Gate-2 review of `conversation-mode-agent-signal` (a non-blocking nit worth a small fix). The conversation-mode hint uses an arming latch: `arm(active)` per user message, consumed by the `before_agent_start` handler for that turn (ADR 0004 §3).

But `before_agent_start` is NOT emitted for every turn:

- A MID-STREAM message (steer / followUp) does not start a fresh agent loop, so `before_agent_start` never fires for it. `pi`'s `agentSession.prompt()` returns early when already streaming.
- A slash / extension command that returns early similarly skips the hook.

In those cases the latch is ARMED but never CONSUMED, so the arming survives until the NEXT turn that does emit `before_agent_start`. Two consequences:

1. That later turn may inherit a hint it did not ask for (the flag arrived one turn late / stray).
2. In a BRIDGE session, a message typed straight into the terminal AFTER a flagged steer would then inherit the hint, which is exactly the terminal-only leak the "consume the latch" design (ADR 0004 §3) exists to prevent.

Worst case is mild: one stray `say` call, or the hint arriving one turn late. Not a correctness hazard, but it defeats the crisp per-turn semantics.

## Suggested fix (small)

Clear the latch on the paths that arm-but-skip-`before_agent_start`:

- On the mid-stream steer / followUp delivery path, and the slash/extension early-return path, disarm (`arm(false)`) after handing the message off, since those turns will not consume it.
- Alternatively, only `arm(true)` on the path that actually reaches a fresh agent loop (i.e. arm just before the non-streaming `sendUserMessage` / `prompt` that emits `before_agent_start`), so a mid-stream send never arms in the first place.

Either keeps the "one flagged message -> exactly that turn's hint" contract. Add a test at the same seam as `server/test/conversation-mode-injection.test.ts`: a flagged mid-stream steer followed by an unflagged turn must NOT inject.

## Why filed, not fixed inline

The fix is a real behavioural change to the arming/consume paths (touching the steer/followUp + early-return branches in `session-pool.ts` and the extension), so it wants its own small task + test rather than being slipped into an unrelated change. Cheap to promote to a task when convenient.
