<!-- dorfl-sidecar: item=task:hands-free-mic-reopen type=task slug=hands-free-mic-reopen allAnswered=false -->

## Q1

**'task:hands-free-mic-reopen' was bounced — how should we proceed?**

> The task rests on a false premise: it says it "OWNS the TTS-done coordination seam" by READING a "TTS-active signal … defined there" in the blockedBy dependency `say-tool-tts-and-card`, and forbids duplicating the wait on the TTS side. That signal does not exist. The shipped dependency (`web/src/lib/core/speak.ts`, commit c8557f3) implements `speakUtterance` as fire-and-forget: `synth.speak(utterance)` with NO `onend`, no active-utterance state, and no exported store/getter/flag indicating "TTS is currently speaking". Its done record + changeset confirm no such signal was produced. So the acceptance criterion "the re-open waits for in-flight TTS to finish (where TTS is active)" cannot be met by reading an existing signal, and the task explicitly forbids adding the wait on the TTS side.
>
> Suggested re-scope (pick one, then either update this task or the TTS task): (A) Add a TTS-active signal to the say/TTS task's owned module `core/speak.ts` — e.g. track outstanding utterances via `utterance.onend`/`onerror` and export a reactive `ttsActive` store (or an `onAllUtterancesDone` promise/callback) — as a small amendment to `say-tool-tts-and-card`, then have THIS task consume it. This keeps ownership of the TTS seam with the TTS task as the current task assumes. (B) Explicitly re-scope THIS task to own the whole TTS-settle coordination (create the active-utterance tracking here, wrapping `speakUtterance`), and drop the "signal is defined there / do not duplicate on the TTS side" wording. Also note (not the blocker, but part of the re-scope): `SpeechButton.svelte` currently exposes neither its `browser`/`cloud` engine nor a programmatic `startRecording()` to a parent, so the browser-engine auto-reopen needs a new small public surface on that component; `ChatInput.focusInput()` already exists for the cloud re-focus fallback.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):

## Q2

**'task:hands-free-mic-reopen' was bounced — how should we proceed?**

> The task rests on a false premise: it says it "OWNS the TTS-done coordination seam" by READING a "TTS-active signal … defined there" in the blockedBy dependency `say-tool-tts-and-card`, and forbids duplicating the wait on the TTS side. That signal does not exist. The shipped dependency (`web/src/lib/core/speak.ts`, commit c8557f3) implements `speakUtterance` as fire-and-forget: `synth.speak(utterance)` with NO `onend`, no active-utterance state, and no exported store/getter/flag indicating "TTS is currently speaking". Its done record + changeset confirm no such signal was produced. So the acceptance criterion "the re-open waits for in-flight TTS to finish (where TTS is active)" cannot be met by reading an existing signal, and the task explicitly forbids adding the wait on the TTS side.
>
> Suggested re-scope (pick one, then either update this task or the TTS task): (A) Add a TTS-active signal to the say/TTS task's owned module `core/speak.ts` — e.g. track outstanding utterances via `utterance.onend`/`onerror` and export a reactive `ttsActive` store (or an `onAllUtterancesDone` promise/callback) — as a small amendment to `say-tool-tts-and-card`, then have THIS task consume it. This keeps ownership of the TTS seam with the TTS task as the current task assumes. (B) Explicitly re-scope THIS task to own the whole TTS-settle coordination (create the active-utterance tracking here, wrapping `speakUtterance`), and drop the "signal is defined there / do not duplicate on the TTS side" wording. Also note (not the blocker, but part of the re-scope): `SpeechButton.svelte` currently exposes neither its `browser`/`cloud` engine nor a programmatic `startRecording()` to a parent, so the browser-engine auto-reopen needs a new small public surface on that component; `ChatInput.focusInput()` already exists for the cloud re-focus fallback.

<!-- q2 fields: id=q2 kind=stuck -->

**Your answer** (write below this line):

## Q3

**'task:hands-free-mic-reopen' was bounced — how should we proceed?**

> The task rests on a false premise: it says it "OWNS the TTS-done coordination seam" by READING a "TTS-active signal … defined there" in the blockedBy dependency `say-tool-tts-and-card`, and forbids duplicating the wait on the TTS side. That signal does not exist. The shipped dependency (`web/src/lib/core/speak.ts`, commit c8557f3) implements `speakUtterance` as fire-and-forget: `synth.speak(utterance)` with NO `onend`, no active-utterance state, and no exported store/getter/flag indicating "TTS is currently speaking". Its done record + changeset confirm no such signal was produced. So the acceptance criterion "the re-open waits for in-flight TTS to finish (where TTS is active)" cannot be met by reading an existing signal, and the task explicitly forbids adding the wait on the TTS side.
>
> Suggested re-scope (pick one, then either update this task or the TTS task): (A) Add a TTS-active signal to the say/TTS task's owned module `core/speak.ts` — e.g. track outstanding utterances via `utterance.onend`/`onerror` and export a reactive `ttsActive` store (or an `onAllUtterancesDone` promise/callback) — as a small amendment to `say-tool-tts-and-card`, then have THIS task consume it. This keeps ownership of the TTS seam with the TTS task as the current task assumes. (B) Explicitly re-scope THIS task to own the whole TTS-settle coordination (create the active-utterance tracking here, wrapping `speakUtterance`), and drop the "signal is defined there / do not duplicate on the TTS side" wording. Also note (not the blocker, but part of the re-scope): `SpeechButton.svelte` currently exposes neither its `browser`/`cloud` engine nor a programmatic `startRecording()` to a parent, so the browser-engine auto-reopen needs a new small public surface on that component; `ChatInput.focusInput()` already exists for the cloud re-focus fallback.

<!-- q3 fields: id=q3 kind=stuck -->

**Your answer** (write below this line):

## Q4

**'task:hands-free-mic-reopen' was bounced — how should we proceed?**

> The task rests on a false premise: it says it "OWNS the TTS-done coordination seam" by READING a "TTS-active signal … defined there" in the blockedBy dependency `say-tool-tts-and-card`, and forbids duplicating the wait on the TTS side. That signal does not exist. The shipped dependency (`web/src/lib/core/speak.ts`, commit c8557f3) implements `speakUtterance` as fire-and-forget: `synth.speak(utterance)` with NO `onend`, no active-utterance state, and no exported store/getter/flag indicating "TTS is currently speaking". Its done record + changeset confirm no such signal was produced. So the acceptance criterion "the re-open waits for in-flight TTS to finish (where TTS is active)" cannot be met by reading an existing signal, and the task explicitly forbids adding the wait on the TTS side.
>
> Suggested re-scope (pick one, then either update this task or the TTS task): (A) Add a TTS-active signal to the say/TTS task's owned module `core/speak.ts` — e.g. track outstanding utterances via `utterance.onend`/`onerror` and export a reactive `ttsActive` store (or an `onAllUtterancesDone` promise/callback) — as a small amendment to `say-tool-tts-and-card`, then have THIS task consume it. This keeps ownership of the TTS seam with the TTS task as the current task assumes. (B) Explicitly re-scope THIS task to own the whole TTS-settle coordination (create the active-utterance tracking here, wrapping `speakUtterance`), and drop the "signal is defined there / do not duplicate on the TTS side" wording. Also note (not the blocker, but part of the re-scope): `SpeechButton.svelte` currently exposes neither its `browser`/`cloud` engine nor a programmatic `startRecording()` to a parent, so the browser-engine auto-reopen needs a new small public surface on that component; `ChatInput.focusInput()` already exists for the cloud re-focus fallback.

<!-- q4 fields: id=q4 kind=stuck -->

**Your answer** (write below this line):

## Q5

**'task:hands-free-mic-reopen' was bounced — how should we proceed?**

> The task rests on a false premise: it says it "OWNS the TTS-done coordination seam" by READING a "TTS-active signal … defined there" in the blockedBy dependency `say-tool-tts-and-card`, and forbids duplicating the wait on the TTS side. That signal does not exist. The shipped dependency (`web/src/lib/core/speak.ts`, commit c8557f3) implements `speakUtterance` as fire-and-forget: `synth.speak(utterance)` with NO `onend`, no active-utterance state, and no exported store/getter/flag indicating "TTS is currently speaking". Its done record + changeset confirm no such signal was produced. So the acceptance criterion "the re-open waits for in-flight TTS to finish (where TTS is active)" cannot be met by reading an existing signal, and the task explicitly forbids adding the wait on the TTS side.
>
> Suggested re-scope (pick one, then either update this task or the TTS task): (A) Add a TTS-active signal to the say/TTS task's owned module `core/speak.ts` — e.g. track outstanding utterances via `utterance.onend`/`onerror` and export a reactive `ttsActive` store (or an `onAllUtterancesDone` promise/callback) — as a small amendment to `say-tool-tts-and-card`, then have THIS task consume it. This keeps ownership of the TTS seam with the TTS task as the current task assumes. (B) Explicitly re-scope THIS task to own the whole TTS-settle coordination (create the active-utterance tracking here, wrapping `speakUtterance`), and drop the "signal is defined there / do not duplicate on the TTS side" wording. Also note (not the blocker, but part of the re-scope): `SpeechButton.svelte` currently exposes neither its `browser`/`cloud` engine nor a programmatic `startRecording()` to a parent, so the browser-engine auto-reopen needs a new small public surface on that component; `ChatInput.focusInput()` already exists for the cloud re-focus fallback.

<!-- q5 fields: id=q5 kind=stuck -->

**Your answer** (write below this line):
