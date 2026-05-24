---
"pi-remote-server": patch
---

Improve speech recording feedback and reliability:
- Transition from `MediaRecorder` to direct `AudioContext` / PCM buffer capture for instant, zero-latency WAV creation.
- Add an audible synthesizer beep / chime on recording start for clear user feedback.
- Introduce an explicit `isProcessing` state during local downsampling and cloud transcription to replace the red pulsing mic indicator with an orange processing indicator.
