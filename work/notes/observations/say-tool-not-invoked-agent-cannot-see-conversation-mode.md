---
title: The `say` tool is never invoked because the agent cannot tell conversation mode is ON
date: 2026-07-25
status: open
relatedSpec: conversation-mode
relatedTask: say-tool-dual-registration
---

## What was observed

On a real phone test of conversation mode (web PWA), the agent produced NORMAL written replies and NEVER called the `say` tool, so nothing was ever spoken, even with conversation mode + speakReplies ON and the TTS gesture-unlock in place. The agent only started calling `say` AFTER the user explicitly told it to speak ("you didn't talk").

This is a DIFFERENT root cause from the mobile TTS gesture-unlock bug (`mobile-tts-gesture-unlock`, already fixed). That fix was still correct (a real mobile gate), but it was not why nothing was heard: there was simply nothing to speak because `say` was never called.

## Evidence (from the user's own sessions)

Session `~/.pi/agent/sessions/--home-wighawag-searches--/2026-07-25T15-09-39-*.jsonl`. The agent explained the cause itself, verbatim:

- "I did not speak initially because my standard instructions are to use the `say` tool only when a spoken conversation is active. When I receive typed messages without any voice indication..."
- "my system instructions specifically state: 'if the user is typing, a written answer alone is enough.' Because your first messages arrived as text..."

A sibling session (`...T14-55-19-*.jsonl`, a print-doc task) confirms it: a full task completed with a normal written reply and zero `say` calls.

## Root cause

The `say` tool's DESCRIPTION + guidelines (authored in `say-tool-dual-registration`, shipped in `server/src/say-tool.ts` + `extension/src/index.ts`) tell the agent:

> "Only use it while a spoken conversation is active; if the user is typing, a written answer alone is enough."

But "conversation mode is active" is state that lives ENTIRELY in the WEB CLIENT (the conversation-mode knobs registry in `web/`). The AGENT has no signal for it: a dictated message and a typed message arrive as identical text on the wire. So the agent, following its instructions literally, cannot know a spoken conversation is active and defaults to "the user is typing -> written answer is enough -> do not call `say`." The tool's own guidance actively steers it AWAY from speaking in exactly the situation the feature exists for.

## Why this matters / impact

Conversation mode's headline behaviour (User Story 4/10 of the `conversation-mode` spec: the agent speaks a short reply via `say`) does NOT happen in practice unless the user manually nags the agent every turn. The feature is effectively inert for its main use case. This is a design gap in the conversation-mode spec: it never specified HOW the agent learns that conversation mode is on.

## The design fork (for a spec/task, not to guess here)

The agent needs a SIGNAL that conversation mode is active. Options:

1. **Inject a system-prompt / context hint when conversation mode is on.** When the web client has conversation mode on, the server tells the agent (a system message / a per-turn preamble / a tool-availability note) "a spoken conversation is active: provide a short `say` reply in addition to your written answer." Requires plumbing the client knob state to the server/agent (a new WS field on the message, or a session flag). Changes the "agent cannot see client state" boundary.
2. **Re-word the `say` tool guidance to be less self-suppressing.** Soften "if the user is typing, a written answer alone is enough" so the agent offers `say` more readily. Cheap, but fuzzy: the agent still has no real signal, so it either over-speaks (when conversation mode is OFF) or under-speaks. Not a real fix alone.
3. **Only register the `say` tool when conversation mode is on.** Tool availability itself becomes the signal: if `say` is present, speak; if absent, do not. Requires the client knob to gate server-side tool registration per session (dynamic tool set), which is a bigger architectural change and interacts with the dual-registration + CLI-bridge design.

Leaning: option 1 (a conversation-mode signal from client -> server -> agent context) is the only one that actually closes the gap; option 2 is a possible stopgap. This needs a `needsAnswers` spec (or an amendment to the conversation-mode spec), because the client->agent signal path is a real design decision with a protocol touchpoint.
