# Conversation Mode: Wake Word Mode ("Hey Shirka")

## Context

A special config mode where the mic stays open continuously and the user can trigger the agent at any time by saying "Hey Shirka" (or any configured wake word). This would enable truly hands-free interaction without needing to keep conversation mode on or tap a button.

## Current Behavior

- Conversation mode requires the user to keep it toggled on and either tap the mic or use auto-send
- No wake-word-based triggering exists

## Desired Behavior

- User can enable a wake-word mode where the mic stays open continuously
- Saying "Hey Shirka" (or configured wake word) triggers the agent
- After wake word detection, the mic stays active for the full conversation (effectively entering conversation mode) until the user toggles it off or the tab is backgrounded

## Implementation Notes

- This is a more complex feature. The basic architecture:
  1. A new config knob `wakeWordEnabled` (boolean) in the wherever config.
  2. A configurable wake word (default "Hey Shirka", but user-customizable).
  3. When enabled, the browser runs continuous speech recognition in the background.
  4. When the wake word is detected, the transcription is sent as a user message (as if the user typed it).
  5. After the wake word triggers, the mic stays active for the full conversation (effectively entering conversation mode) until the user toggles it off or the tab is backgrounded.

- **Technical challenges**:
  - Web Speech API's `SpeechRecognition` can run continuously (`continuous: true`), but browsers kill it when the tab is backgrounded or after a period of silence.
  - Wake word detection must happen CLIENT-SIDE (no server round-trip for every word). This means we need to listen for ALL speech, check if it starts with the wake word, and if so, send the rest as a message.
  - The "Hey Shirka" phrase needs to be detected from the interim results of the speech recognition (before the final result comes through).
  - Privacy: the mic is always on, which is a significant user trust consideration. Must be opt-in and clearly indicated (a persistent "listening" indicator).

- **Architecture**:
  - New module: `core/wake-word.ts` that owns the continuous recognition loop.
  - It maintains a buffer of recent interim transcriptions. When the buffer matches the wake word pattern, it triggers.
  - After triggering, it hands off to the normal conversation-mode flow (effectively turning conversation mode on and starting a normal recording session).
  - The wake-word detector runs as a singleton, independent of conversation mode state.

- **UI**:
  - A toggle in Connection Settings for "Wake word mode" with the wake word text input.
  - A subtle indicator in the top bar when wake word mode is active (e.g., a small microphone icon with a label "Listening for 'Hey Shirka'").
  - When the wake word is detected, the indicator briefly shows "Detected!" before transitioning to conversation mode.

- **Future**: This could be extended with on-device ML wake word detection (e.g., using TensorFlow.js with a small wake word model) for more reliable detection, but the Web Speech API approach is the pragmatic first step.

## Future Extensions

- **Custom wake words**: Let users set their own wake word (not just "Hey Shirka").
- **Voice commands**: Beyond just sending messages, support voice commands like "abort", "new session", "change model".
- **Multi-language wake words**: Support different wake words for different locales.
- **Background listening optimization**: Use the Page Visibility API to pause the mic when the tab is backgrounded, and resume when it becomes visible again.
- **Wake word model**: Replace the regex-based detection with a proper on-device ML model for better accuracy and lower CPU usage.
- **Proximity to always-on**: This could eventually replace conversation mode entirely, making it a purely wake-word-driven interaction model.