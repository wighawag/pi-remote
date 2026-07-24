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

**This task OWNS the whole TTS-done coordination seam — including PRODUCING the "TTS finished" signal.** When `speakReplies` is on, a `say` reply is being spoken via `core/speak.ts`'s `speakUtterance`; the mic must not re-open until that utterance FINISHES, so the spoken reply is not captured as microphone input. The shipped `speakUtterance` (from `say-tool-tts-and-card`) is FIRE-AND-FORGET — it calls `synth.speak(utterance)` with no `onend`/`onerror` handling and exposes NO "is TTS speaking / has it finished" signal. So this task must ADD that minimal signal itself, in `core/speak.ts` (the module that owns the TTS lifecycle): track outstanding utterances via `utterance.onend`/`onerror` and expose a small settle primitive the hands-free loop consumes (e.g. a `whenTtsIdle()` promise/callback, or an `isTtsSpeaking()` getter / reactive flag). Keep it minimal and additive — do not change `speakUtterance`'s existing call sites' behaviour, and do not re-implement TTS elsewhere. When `speakReplies` is off (no utterance was ever fired) the signal reports idle immediately, so the re-open is not blocked.

**A second required surface: `SpeechButton.svelte` must expose a small public API for the browser-engine auto-reopen.** Today it exposes neither its `browser`/`cloud` engine choice nor a programmatic way to start recording to a parent. The browser-engine auto-reopen needs one (e.g. a bindable/exported `startRecording()` plus a way to read the active engine), so the settle-edge driver can trigger a recognition restart. Add that minimal public surface. The CLOUD re-focus fallback needs no new surface — `ChatInput.focusInput()` already exists.

## Acceptance criteria

- [ ] With `micReopensAfterReply` ON and the BROWSER engine active, after the agent settles (the `isStreaming` true→false edge) and any TTS finishes, the mic re-opens automatically for another turn.
- [ ] With the knob ON and the CLOUD engine active, the composer is re-focused (no auto-record) — the browser-only auto-reopen does NOT fire on cloud.
- [ ] With the knob OFF (or conversation mode off), neither the mic re-opens nor the composer is auto-focused as a result of a reply settling.
- [ ] `core/speak.ts` exposes a minimal TTS-settle signal (tracking `utterance.onend`/`onerror`) reporting whether TTS is currently speaking / when it has finished, and reports idle immediately when no utterance was fired (speakReplies off). The re-open waits on this signal so it does not capture the spoken reply as input.
- [ ] `SpeechButton.svelte` exposes the minimal public surface the browser-engine auto-reopen needs (a programmatic recording start + the active engine), and the cloud fallback uses the existing `ChatInput.focusInput()`.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style): a unit/component test that the settle edge with the knob on + browser engine re-opens the mic, with cloud engine re-focuses the composer instead, and with the knob off does neither.

## Blocked by

- `conversation-mode-knobs-registry` — the `micReopensAfterReply` knob (and the master `conversationMode` gate) is defined there.
- `say-tool-tts-and-card` — this task builds ON its shipped `core/speak.ts`/`speakUtterance` and the `say` card (the merged TTS surface it must coordinate with), and serializes after it to keep the TTS↔hands-free coordination single-owner. NOTE: that task shipped `speakUtterance` fire-and-forget with NO TTS-done signal, so THIS task must ADD that signal to `core/speak.ts` itself (see What to build) rather than read a pre-existing one.

## Prompt

> Goal: add the hands-free `micReopensAfterReply` loop to the Wherever web dashboard (`web/`) — after the agent finishes and any TTS is done, re-open the mic (browser engine) or re-focus the composer (cloud engine) so the user can keep talking without tapping.
>
> FIRST, drift-check against reality: confirm (a) the `micReopensAfterReply` knob + master `conversationMode` gate exist in the conversation-mode knobs registry (see `conversation-mode-knobs-registry` in `tasks/done/`), (b) the waiting-for-human beep still fires on the `isStreaming` true→false settle edge (the same edge to hook), and (c) how `core/speak.ts`'s `speakUtterance` and `SpeechButton.svelte` actually landed. IMPORTANT (already confirmed, do NOT re-derive): `speakUtterance` is FIRE-AND-FORGET (`synth.speak(utterance)`, no `onend`, no TTS-done signal), and `SpeechButton.svelte` exposes neither its engine nor a programmatic recording start to a parent. So this task must ADD both a minimal TTS-settle signal to `core/speak.ts` AND a minimal public surface to `SpeechButton.svelte` — see What to build. If anything ELSE landed differently, route to needs-attention rather than building on a stale premise.
>
> Where to look (by concept, not brittle paths): the web lib module owns the `isStreaming` settle-edge subscription (the beep trigger is the model to mirror for detecting "agent just settled"); the speech button component owns the browser vs cloud engine and the recording start; the composer/input component owns the textarea focus.
>
> Key decisions already made (do not re-litigate): Open Question 3 resolved — auto-reopen is BROWSER-engine ONLY (streaming recognition restarts cleanly); the CLOUD engine (explicit hold-to-talk / tap-to-toggle) FALLS BACK to re-focusing the composer, no auto-record (auto-record has no natural gesture there and would surprise the user). Hook the SAME `isStreaming` true→false edge the beep uses, and wait for in-flight TTS to finish before re-opening so the spoken reply is not captured as input. Gated by conversation mode + the `micReopensAfterReply` knob; off by default (when off, nothing re-opens/auto-focuses).
>
> Done = the mic re-opens on browser / composer re-focuses on cloud after a reply settles when the knob is on (and neither when off), and the tests above pass. Changeset per AGENTS.md: web-only → `"wherever-dev": patch` (never `@wherever-dev/web`).
