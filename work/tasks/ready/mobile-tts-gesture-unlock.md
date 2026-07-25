---
title: Fix conversation-mode TTS silently not firing on mobile Chrome / iOS / PWA (gesture-unlock)
slug: mobile-tts-gesture-unlock
spec: conversation-mode
blockedBy: []
covers: [8]
---

## What to build

Fix the bug where the conversation-mode spoken reply (the `say` tool's browser TTS) **silently never fires on mobile Chrome, iOS Safari, and installed PWAs**, while working on desktop.

Root cause: the TTS utterance is fired from a WebSocket-driven `$effect` reacting to an incoming `say` tool call (in the chat message list), so there is **no user gesture in that call stack**. Mobile Chrome / iOS Safari / PWA webviews gate the FIRST `speechSynthesis.speak()` behind [user activation](https://developer.mozilla.org/en-US/docs/Web/Security/User_activation): a `speak()` issued outside a real tap/click handler is silently dropped (no error, `onend` may never fire). Desktop has no such gate, which is why it passed testing there.

The fix is the standard mobile-Chrome/iOS **gesture-unlock** pattern (mirroring how `core/beep.ts` already resumes a suspended `AudioContext` on user interaction): the first time the user makes a gesture that implies they want spoken replies, prime `speechSynthesis` inside that gesture handler so subsequent gesture-less `speak()` calls are permitted for the session.

Concretely:

- Add a one-time **TTS unlock** to `core/speak.ts`: an idempotent function that, inside a user gesture, speaks a silent/empty priming utterance (and/or calls `speechSynthesis.resume()`) to satisfy user activation, then records that TTS is unlocked for this session. Feature-detected + swallow-all (a no-op when `speechSynthesis` is absent), matching the module's existing "spoken reply is a nicety, never a throw" posture.
- Call the unlock from the **Conversation Mode toggle** tap handler (the natural gesture: turning conversation mode ON is the user opting into spoken replies). Optionally also unlock on the mic-button tap, since that is another clear "I want a spoken exchange" gesture. Do NOT try to unlock from a non-gesture code path (it will not work).
- When a `say` reply later fires the gesture-less `speak()`, also issue a defensive `speechSynthesis.resume()` kick first: mobile Chrome can leave the queue paused, which drops the utterance even after unlock.
- The existing TTS-settle signal (`whenTtsIdle`/`isTtsSpeaking`, used by the hands-free loop) must keep working unchanged: a primed/silent unlock utterance must NOT leak an outstanding-utterance count (do not let the priming utterance be tracked as a real spoken reply).

Behaviour is otherwise unchanged: desktop still works, and with conversation mode / `speakReplies` off nothing speaks.

## Acceptance criteria

- [ ] On mobile Chrome / iOS Safari / an installed PWA, after the user turns Conversation Mode ON (the gesture that unlocks TTS), a subsequent `say` reply is spoken aloud (the utterance is no longer silently dropped).
- [ ] Desktop behaviour is unchanged (TTS still speaks; no double-speak, no regression).
- [ ] The unlock is idempotent and gesture-scoped: calling it repeatedly (or from a non-gesture path) does not throw and does not speak an audible priming sound to the user.
- [ ] The priming/unlock utterance does NOT leak into the TTS-settle signal (`isTtsSpeaking()` / `whenTtsIdle()` still report only real `say` replies, so the hands-free mic-reopen loop is unaffected).
- [ ] With conversation mode off or `speakReplies` off, nothing speaks (unchanged): the unlock only primes, it never speaks a real reply on its own.
- [ ] A gesture-less first `speak()` (no prior unlock) still degrades gracefully (no throw), matching today's no-op-on-failure posture.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style, i.e. pure-seam unit tests in `core/*.test.ts`, as the web harness is node-env with no jsdom): the unlock primes speechSynthesis exactly once and is idempotent; the priming utterance is not counted by the settle signal; a `resume()` kick is issued on a real reply; feature-absent is a no-op.

## Blocked by

- None, can start immediately. (The conversation-mode TTS surface it fixes is already merged in `tasks/done/say-tool-tts-and-card.md`.)

## Prompt

> Goal: fix the conversation-mode spoken reply (the `say` tool's browser TTS) silently NOT firing on mobile Chrome, iOS Safari, and installed PWAs in the Wherever web dashboard (`web/`). It works on desktop but not mobile.
>
> FIRST, drift-check against reality: confirm (a) the TTS path still lives in `core/speak.ts` (`speakUtterance`, plus the `whenTtsIdle`/`isTtsSpeaking`/`resetTtsSettleSignal` settle signal), (b) it is fired from a WebSocket-driven `$effect` in the chat message list when a `say` message settles (NOT from a user gesture), and (c) the Conversation Mode toggle handler (`toggleConversationMode`) is a real tap/click handler you can hook. If any landed differently, reconcile before building.
>
> The bug (already diagnosed, do not re-derive): mobile Chrome / iOS Safari / PWA webviews require the FIRST `speechSynthesis.speak()` to occur inside a user gesture (user activation). The current `say`-driven `speak()` has no gesture in its call stack, so mobile silently drops it. Desktop has no such gate.
>
> The fix (standard pattern, and the repo already does the analogue for audio): a one-time gesture-unlock. Add an idempotent `unlockTts()` to `core/speak.ts` that, when called INSIDE a user gesture, primes `speechSynthesis` (a silent/empty priming utterance and/or `speechSynthesis.resume()`) and records it unlocked for the session; feature-detected and swallow-all like the rest of the module. Call it from `toggleConversationMode` (turning conversation mode ON is the user opting into spoken replies), and optionally from the mic-button tap. On a real `say` reply, also issue a defensive `speechSynthesis.resume()` before `speak()` (mobile Chrome can leave the queue paused). Look at `core/beep.ts` for the existing "resume a suspended AudioContext on user interaction" precedent to mirror the shape.
>
> CRITICAL: do NOT let the priming/unlock utterance leak into the TTS-settle signal. `isTtsSpeaking()` / `whenTtsIdle()` must keep reporting only real `say` replies, or the hands-free mic-reopen loop will think TTS is speaking forever. Keep the unlock path separate from the tracked-utterance path in `speakUtterance`.
>
> Test at the pure seam in `core/speak.ts` (the web harness is node-env with no jsdom/svelte, so mirror `speak.test.ts`/`collapse-reply.test.ts`): unlock primes once + is idempotent + does not throw from a non-gesture/feature-absent path; the priming utterance is not settle-counted; a resume kick is issued on a real reply.
>
> Done = a `say` reply is spoken on mobile after the user turns Conversation Mode on, desktop is unchanged, the settle signal + hands-free loop are unaffected, and the tests pass. Changeset per AGENTS.md: web-only → `"wherever-dev": patch` (never `@wherever-dev/web`).
