---
title: review-gate non-blocking nits for 'conversation-mode-agent-signal' (Gate 2 approve)
date: 2026-07-25
status: open
reviewOf: conversation-mode-agent-signal
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'conversation-mode-agent-signal' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- A mid-stream message (steer/followUp) never triggers before_agent_start, so the latch is armed but never consumed: that turn gets no hint, and the arming survives until some later turn. In a bridge session a message typed straight into the terminal after a flagged steer WOULD then inherit the hint, which is exactly the leak the decisions note claims consuming prevents. Same shape after a slash/extension command that returns early. Ratify as acceptable (worst case: one stray say, or the hint arriving one turn late) or clear the latch on the steer/followUp and early-return paths.
  (server/src/session-pool.ts arm() before the prompt/sendUserMessage split; pi agent-session.prompt() returns early for isStreaming before emitBeforeAgentStart; extension/src/index.ts arms on every cli_message including relayed steers)
- work/notes/observations/conversation-mode-signal-decisions.md is a record of decisions WE made plus why, which per the work contract belongs in docs/adr/ (observations are spotted/unverified). Decision 1 in particular (an INLINE pi extension is the SDK-supported route for a server-side before_agent_start hook, and the stated precedent for future server-side hooks) is load-bearing for later tasks and would be found faster as a numbered ADR beside 0001-0003.
  (work/notes/observations/conversation-mode-signal-decisions.md vs docs/adr/000{1,2,3}-*.md; bucket polarity in work/protocol/WORK-CONTRACT.md)
- Ratify the wire field NAME: conversationMode on the message payload means master conversationMode AND speakReplies, while conversationMode in the knobs registry is the master toggle alone. One word, two meanings across layers. It is documented in CONTEXT.md and protocol.ts, but a later reader of msg.conversationMode can reasonably assume it mirrors the master knob. Ratify, or rename the wire field to something like spokenConversation.
  (server/src/protocol.ts message payload; web/src/lib/core/conversation-mode.ts shouldSignalConversationMode returns isKnobActive('speakReplies') i.e. master AND speakReplies)
- Ratify two recorded deviations: (a) the hint text is DUPLICATED in server/src/conversation-mode-hint.ts and extension/src/conversation-mode-hint.ts rather than defined once, using the task's sanctioned fallback plus a real drift guard (server/test/conversation-mode-hint.test.ts imports both); (b) the changeset also bumps @wherever-dev/client, beyond the task's web+client+server -> wherever-dev mapping, on the cited precedent of the superseded-session-load changeset (verified in history).
  (decisions note items 2 and 4; .changeset/conversation-mode-agent-signal.md lists client, wherever-dev, pi and never web)
- The say tool description/guidelines are edited in lockstep in server/src/say-tool.ts and extension/src/index.ts but nothing FAILS if only one is later edited (the new hint text has such a guard, the say text does not). Consider extending the lockstep test to the say description strings.
  (server/test/say-tool.test.ts asserts only the server copy; conversation-mode-hint.test.ts is the pattern to copy)
