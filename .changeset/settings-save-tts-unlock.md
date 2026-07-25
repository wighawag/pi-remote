---
"wherever-dev": patch
---

Prime browser TTS when spoken replies are enabled from Connection Settings, closing a mobile gap in the conversation-mode gesture-unlock. Enabling conversation mode + speak-replies via the settings checkboxes is a real user gesture, so `unlockTts()` is now called from that save handler too. Without it, a mobile Chrome / iOS / PWA user who turned spoken replies on from settings and then only typed (never tapping the master toggle or the mic) would have their first `say` reply silently dropped by the browser's user-activation gate. The call is idempotent and only primes when spoken replies are actually intended.
