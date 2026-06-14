---
"wherever-dev": patch
---

Fix stale data on first load: the service worker no longer serves cached responses for dynamic server API endpoints (`/sessions`, `/config`, `/models`, `/check-path`, `/autocomplete-path`, `/session/*`, `/health`), which are now fetched online-first. App-shell navigations are also served online-first so a freshly deployed build is picked up without needing a second reload. Hashed assets and images remain cache-first for offline support.
