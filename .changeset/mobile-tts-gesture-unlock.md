---
"wherever-dev": patch
---

Fix the conversation-mode spoken reply never being heard on mobile Chrome, iOS Safari and installed PWAs. Those browsers only allow the first `speechSynthesis.speak()` of a page from inside a user gesture, and the `say` reply speaks from a WebSocket-driven effect, so mobile silently dropped every utterance (desktop has no such gate, which is why it looked fine there). Speech synthesis is now primed once, silently, from a real tap: the Conversation Mode toggle, and the mic button (which also covers a returning user whose conversation mode was already persisted on). A real `say` reply additionally issues a defensive `resume()` kick, since mobile Chrome can leave the utterance queue paused. The priming utterance is kept off the TTS-settle signal, so `isTtsSpeaking()` / `whenTtsIdle()` still report only real spoken replies and the hands-free mic-reopen loop is unchanged.
