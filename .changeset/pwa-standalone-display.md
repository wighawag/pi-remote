---
"wherever-dev": patch
---

PWA: set the web manifest `display` to `standalone` (was the pwag default `fullscreen`) and give the app a real identity (`name`/`title` "Wherever" with a proper description) instead of the template placeholder. This makes the installed app launch in its own window rather than a normal browser tab on browsers that honor `standalone`.
