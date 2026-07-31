# Conversation Mode: Interrupt Button for Active Speech

## Context

The agent can produce very long spoken replies (e.g., reading a full tool description when the `say` tool wasn't activated). There is currently no way for the user to interrupt the speech once it starts playing. The user has to wait for the entire utterance to finish, which feels particularly bad when the agent rambles through a 500-word tool description.

## Current Behavior

- No interrupt mechanism exists
- User must wait for the entire TTS utterance to finish
- Long tool descriptions being read aloud are especially problematic

## Desired Behavior

- User can click an "Interrupt" / "Stop" button to stop the agent mid-speech
- Button appears only when TTS is actively speaking
- Quick way to regain control without waiting for long utterances

## Implementation Notes

- The TTS is driven by `speakUtterance()` in `core/speak.ts`. This uses the browser `speechSynthesis` API.
- `speechSynthesis` has a built-in `speechSynthesis.cancel()` method that stops all current utterances.
- Add an "Interrupt" / "Stop" button that appears when TTS is actively speaking. The button should be visible in the top bar (near the conversation mode toggle) or as a floating button near the spoken reply card.
- Detection of "is speaking": `speechSynthesis.speaking` property + `speechSynthesis.pending` for queued utterances.
- The button should only appear when:
  - Conversation mode is ON, AND
  - `speechSynthesis.speaking === true` OR `speechSynthesis.pending > 0`
- Implementation in `core/speak.ts`: export a `stopSpeaking()` function that calls `speechSynthesis.cancel()`, and a derived store `isSpeaking` that reflects the current speaking state.
- Add the button in the top bar of `ChatMessageList.svelte`, next to the conversation mode toggle.

## Code Sketch

```typescript
// core/speak.ts
export function stopSpeaking() {
  try {
    speechSynthesis?.cancel();
  } catch {}
}

// Reactive store tracking whether TTS is currently speaking
export const isSpeaking = writable<boolean>(false);

function updateSpeakingState() {
  isSpeaking.set(!!speechSynthesis?.speaking || speechSynthesis?.pending);
}
// Listen for onstart/onend events to keep the store in sync
```

```svelte
<!-- ChatMessageList.svelte (top bar) -->
{#if $isSpeaking}
  <button
    onclick={stopSpeaking}
    class="rounded bg-rose-500 px-2 py-1 text-xs text-white transition-colors hover:bg-rose-600"
    title="Stop speaking"
  >
    ⏹ Stop
  </button>
{/if}
```