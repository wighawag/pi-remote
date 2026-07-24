---
title: review-gate non-blocking nits for 'hands-free-mic-reopen' (Gate 2 approve)
date: 2026-07-24
status: open
reviewOf: hands-free-mic-reopen
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'hands-free-mic-reopen' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: the settle-edge is detected with a local $effect prev-flag (prevStreamingForReopen) in ChatInput rather than a shared settle-edge store. It initialises false, so if ChatInput mounts while already streaming the FIRST true->false edge on that mount is missed (no reopen for that one turn). Acceptable edge case, but an unrecorded in-scope choice worth a human nod.
  (web/src/lib/components/ChatInput.svelte:266-289)
- Ratify: resetTtsSettleSignal() is exported as a public primitive (used for test teardown AND documented for session-teardown speechSynthesis.cancel()). No caller wires it into the actual session-teardown path in this diff, so the cancel-without-onend leak it guards against is only mitigated in tests today. Confirm that is intended for this slice.
  (web/src/lib/core/speak.ts resetTtsSettleSignal; no non-test caller found)
- Ratify design reality: browser-engine auto-reopen calls SpeechRecognition.start() programmatically with no fresh user gesture. This is the resolved Open-Question-3 intent (streaming recognition restarts cleanly) and Web Speech recognition does not require user-activation like getUserMedia, so it is expected to work, but it is a user-visible behavioural choice to ratify.
  (SpeechButton startRecordingProgrammatically -> startRecording -> startBrowserRecording)
- The PR/commit carries no '## Decisions' block; the in-scope choices above were reconstructed by review. Future slices should record them so ratification is not review-derived.
  (git show ef1f8f0 body empty; task done file has no Decisions block)
