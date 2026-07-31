# Conversation Mode: Auto-Mic on Toggle

## Context

When the user clicks the conversation mode toggle (🗣️) in the top bar to activate it, the mic should automatically start recording. Currently the user has to manually tap the mic button after enabling conversation mode, which is an extra step for what should be a seamless transition into voice interaction.

## Current Behavior

- User clicks 🗣️ toggle → conversation mode turns on → user must tap the mic button to start recording.

## Desired Behavior

- User clicks 🗣️ toggle → conversation mode turns on → mic automatically starts recording.

## Implementation Notes

- The conversation mode toggle lives in `ChatMessageList.svelte` (`toggleConversationMode()` at line ~371).
- The mic button is `SpeechButton.svelte`, and the programmatic recording entry point is `startRecordingProgrammatically()` (exported, bound via `bind:this={speechButton}` in ChatInput).
- The mic button is in `ChatInput.svelte`, not `ChatMessageList.svelte`. The toggle is in the top bar (ChatMessageList), while the mic is in the composer (ChatInput).
- Need to expose a `startMicOnConversationMode` store/event that ChatInput subscribes to, OR move the auto-mic logic to wherever.ts as a side effect when conversation mode turns on, OR have the toggle emit a signal that ChatInput reacts to.
- The cleanest path: add a writable store `conversationModeJustTurnedOn` in `wherever.ts` that fires whenever `setConversationModeBundle(true)` is called. ChatInput's `onMount` or a `$effect` watches this and calls `speechButton.startRecordingProgrammatically()` after a brief delay (e.g., 100ms) to let the UI settle.
- Guard: only auto-start if the browser has already granted mic permissions (check `navigator.mediaDevices.getUserMedia` availability). If permissions haven't been granted yet, just turn on conversation mode and let the user tap the mic as before (the existing gesture-unlock path already handles TTS priming).
- Also need to handle the case where mic permissions are denied: don't error, just silently skip auto-start.

## Code Sketch

```typescript
// wherever.ts
export const conversationModeJustTurnedOn = writable<boolean>(false);

export function setConversationModeBundle(on: boolean) {
  if (get(conversationModeSessionKeyStore)) {
    setConversationModeSessionOverride(on);
  } else {
    setConversationModeDefault(on);
  }
  // Signal consumers that the mode just flipped
  if (on) {
    conversationModeJustTurnedOn.set(true);
    // Reset after a tick so it only fires once
    queueMicrotask(() => conversationModeJustTurnedOn.set(false));
  }
}
```

```svelte
<!-- ChatInput.svelte -->
$effect(() => {
  if ($conversationModeJustTurnedOn && !effectivelyDisabled) {
    setTimeout(() => speechButton?.startRecordingProgrammatically(), 150);
  }
});
```