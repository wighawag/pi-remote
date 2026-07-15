---
"wherever-dev": patch
---

Keep the scroll position anchored when loading older messages. Previously, clicking "Load older messages" preserved the distance from the bottom, which could visually shift the content the user was reading once the older window was prepended. Now the client records the message that was first before the load and, after the older messages are prepended, scrolls so that same message stays in place near the top of the viewport, leaving a small gap above it that reveals the newly loaded messages. If the anchor message can't be located after the prepend, it falls back to the previous "preserve distance from bottom" behavior so the content never jumps unexpectedly.
