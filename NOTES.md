# Speech and Microphone Recording Notes

These are notes on microphone recording improvements, potential enhancements, and fixing the recording feedback UI.

---

## 1. Direct WAV Generation from Microphone
Currently, `SpeechButton.svelte` records in a browser-native format (`audio/webm` or `audio/mp4`) via `MediaRecorder`, and then when recording stops, it uses `AudioContext` to decode the raw binary into a PCM channel array and encodes it into a WAV file.

### How to generate WAV directly:
Instead of utilizing `MediaRecorder` which introduces double-encoding overhead:
1. We can use the Web Audio API directly with an `AudioWorklet` (or the older `ScriptProcessorNode` fallback) to stream raw PCM buffers directly from the mic stream.
2. We can collect these raw Float32 chunks in-memory.
3. Upon stopping, we can immediately convert the raw Float32 stream into a 16-bit PCM WAV blob, bypassing `MediaRecorder` and `AudioContext.decodeAudioData()` entirely.

---

## 2. Emitting a Beep on Recording Start
Adding audio feedback on recording start (like a walkie-talkie chirp or simple beep) helps the user know when the microphone is actually active and when they can start speaking.

### How to implement:
We can dynamically synthesize a beep sound using standard browser Web Audio API:
```javascript
function playBeep() {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, ctx.currentTime); // 440 Hz (A4 note)
    
    // Soft volume decay to avoid a clicking sound at the end
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.15);
}
```
This is self-contained, doesn't require loading external static assets, and works entirely client-side.

---

## 3. Fixing the "Red Mic Button" Lag (Recording vs. Processing)
**Issue:** Currently, the mic button remains red (indicating "Recording...") even after the user has released the walkie-talkie hold or tapped to stop.
**Why it happens:** In `SpeechButton.svelte`, `isRecording` remains `true` throughout the entire `recorder.onstop` callback. This callback performs local audio decoding/downsampling AND wait times for the cloud API network request (`fetch(`${baseUrl}/session/transcribe`)`).
**Fix:** 
Introduce an `isProcessing` state (or `status` enum: `'idle' | 'recording' | 'processing'`).
- When the user releases/stops the microphone, immediately set `isRecording = false` and `isProcessing = true`.
- Change the button styling to reflect the change:
  - **Recording:** Red pulsing background / icon.
  - **Processing:** Yellow/orange, blue, or purple (non-pulsing) background / spinning loader or different icon.
  - **Idle:** Normal gray icon.
- In the `finally` block of the transcription request, set `isProcessing = false`.

---

## Future Action Items
- [ ] Migrate `MediaRecorder` to direct `AudioContext` / PCM buffer capture for instant WAV creation.
- [ ] Add synth audio beep / chime upon starting mic capture.
- [ ] Implement an explicit `isProcessing` state in `SpeechButton.svelte` and color-code the states.
