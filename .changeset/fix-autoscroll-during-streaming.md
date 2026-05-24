---
'pi-remote-web': patch
---

Fix auto-scrolling bug by guarding the force-scroll effect to trigger only when the active session's file actually changes, rather than on every state/token update.
