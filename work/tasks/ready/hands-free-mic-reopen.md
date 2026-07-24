---
title: micReopensAfterReply — hands-free mic re-open (browser engine) with cloud re-focus fallback
slug: hands-free-mic-reopen
spec: conversation-mode
blockedBy: [conversation-mode-knobs-registry, say-tool-tts-and-card]
covers: [7]
---

## What to build

The hands-free loop knob. When `micReopensAfterReply` is on (and conversation mode is on), after the agent settles (the `isStreaming` true→false edge the waiting-for-human beep already uses) AND any in-flight TTS finishes, re-open the mic so the user can carry on speaking without tapping.

Engine scope (Open Question 3 resolved): the auto-reopen is BROWSER-engine only (the streaming speech-recognition engine, where restarting recognition is a clean auto-restart). On the CLOUD engine (explicit hold-to-talk / tap-to-toggle with `getUserMedia` + manual WAV encode), there is no natural auto-record gesture, so the fallback is to just RE-FOCUS the composer (no auto-record). When the knob is off (or conversation mode is off), nothing re-opens.

**This task OWNS the TTS-done coordination seam.** When `speakReplies` is on, a `say` reply is being spoken (the TTS from the `say-tool-tts-and-card` task); the mic must not re-open until that utterance FINISHES, so the spoken reply is not captured as microphone input. This task owns waiting for in-flight TTS to settle before re-opening (that is why it is `blockedBy` the TTS task — the TTS-active signal it reads is defined there). Do not duplicate the wait on the TTS side.

## Acceptance criteria

- [ ] With `micReopensAfterReply` ON and the BROWSER engine active, after the agent settles (the `isStreaming` true→false edge) and any TTS finishes, the mic re-opens automatically for another turn.
- [ ] With the knob ON and the CLOUD engine active, the composer is re-focused (no auto-record) — the browser-only auto-reopen does NOT fire on cloud.
- [ ] With the knob OFF (or conversation mode off), neither the mic re-opens nor the composer is auto-focused as a result of a reply settling.
- [ ] The re-open waits for in-flight TTS to finish (so it does not capture the spoken reply as input) where TTS is active.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style): a unit/component test that the settle edge with the knob on + browser engine re-opens the mic, with cloud engine re-focuses the composer instead, and with the knob off does neither.

## Blocked by

- `conversation-mode-knobs-registry` — the `micReopensAfterReply` knob (and the master `conversationMode` gate) is defined there.
- `say-tool-tts-and-card` — this task waits for in-flight `say` TTS to finish before re-opening the mic, so it depends on the TTS-active signal defined there (and serializes to keep the coordination single-owner).

## Prompt

> Goal: add the hands-free `micReopensAfterReply` loop to the Wherever web dashboard (`web/`) — after the agent finishes and any TTS is done, re-open the mic (browser engine) or re-focus the composer (cloud engine) so the user can keep talking without tapping.
>
> FIRST, drift-check against reality: confirm (a) the `micReopensAfterReply` knob + master `conversationMode` gate exist in the conversation-mode knobs registry (see `conversation-mode-knobs-registry` in `tasks/done/`), (b) the waiting-for-human beep still fires on the `isStreaming` true→false settle edge (the same edge to hook), and (c) the speech button still exposes the browser-vs-cloud engine and a way to programmatically start recording / where the composer textarea lives. If any landed differently, route to needs-attention rather than building on the stale premise.
>
> Where to look (by concept, not brittle paths): the web lib module owns the `isStreaming` settle-edge subscription (the beep trigger is the model to mirror for detecting "agent just settled"); the speech button component owns the browser vs cloud engine and the recording start; the composer/input component owns the textarea focus.
>
> Key decisions already made (do not re-litigate): Open Question 3 resolved — auto-reopen is BROWSER-engine ONLY (streaming recognition restarts cleanly); the CLOUD engine (explicit hold-to-talk / tap-to-toggle) FALLS BACK to re-focusing the composer, no auto-record (auto-record has no natural gesture there and would surprise the user). Hook the SAME `isStreaming` true→false edge the beep uses, and wait for in-flight TTS to finish before re-opening so the spoken reply is not captured as input. Gated by conversation mode + the `micReopensAfterReply` knob; off by default (when off, nothing re-opens/auto-focuses).
>
> Done = the mic re-opens on browser / composer re-focuses on cloud after a reply settles when the knob is on (and neither when off), and the tests above pass. Changeset per AGENTS.md: web-only → `"wherever-dev": patch` (never `@wherever-dev/web`).
