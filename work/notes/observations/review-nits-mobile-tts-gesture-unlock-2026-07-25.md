---
title: review-gate non-blocking nits for 'mobile-tts-gesture-unlock' (Gate 2 approve)
date: 2026-07-25
status: open
reviewOf: mobile-tts-gesture-unlock
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'mobile-tts-gesture-unlock' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the decision to also prime from the mic-button pointerdown: SpeechButton is shared by dictation-only users, so a first mic tap now speaks a whitespace volume-0 utterance even when conversationMode / speakReplies are OFF. It is silent and idempotent, but it is a cross-surface side effect on a component the task only listed as optional scope. Should the mic unlock be gated on the conversation-mode / speakReplies knob instead?
  (web/src/lib/components/speech/SpeechButton.svelte:490 (unlockTts() unconditionally in the pointerdown handler); task said 'Optionally also unlock on the mic-button tap'. Recorded in CONTEXT.md:166 and the changeset.)
- Coverage gap: conversationMode and speakReplies can ALSO be turned on from the Connection Settings save (a real gesture), and that path does not call unlockTts(). A mobile user who enables the mode there and then types (never tapping the master toggle or the mic) still gets the first say reply silently dropped until some later tap. Wire unlockTts() into the settings-save handler, or accept as a known second-tap case?
  (web/src/lib/components/ConnectionSettings.svelte:45-83 writes conversationMode/speakReplies; the only unlock call sites are ChatMessageList.svelte:356 and SpeechButton.svelte:490.)
- Latch semantics: ttsUnlocked is set true whenever speak() does not THROW, but the failure mode this task exists to fix is a silent DROP with no throw. If a prime is ever issued where activation was not actually consumed, the session latches 'unlocked' and no later gesture re-primes. Is best-effort-once the intended contract, or should the latch be confirmed (e.g. only latch on a browser-observable signal)?
  (web/src/lib/core/speak.ts:163-186 (ttsUnlocked = true immediately after synth.speak(priming)); the docs at speak.ts:150 claim it 'stays lockable' only for the throw / feature-absent paths.)
- Residual unverified risk on the primary acceptance criterion: the priming utterance is whitespace text with volume = 0, and whether that reliably consumes user activation on iOS Safari / installed PWAs cannot be shown by the node-env unit suite. Worth one real-device confirmation before this is treated as closed; if volume 0 turns out not to prime on iOS, a near-zero volume is the usual fallback.
  (web/src/lib/core/speak.ts:170-172; acceptance criterion 1 (spoken on mobile Chrome / iOS / PWA) is device-only and the tests pin the seam, not the browser gate.)
- Bookkeeping: the task file landed in work/tasks/done/ still carries needsAnswers: true from the earlier surface, and the requeue note it resolves is now stale. Should the done-move clear the gate axis (or is that runner-owned)?
  (work/tasks/done/mobile-tts-gesture-unlock.md frontmatter needsAnswers: true, plus the '## Requeue 2026-07-25' block whose one-line fix has landed (git diff 012a260..6c380ee removes only the stray tag line).)
