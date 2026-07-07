---
"wherever-dev": patch
---

Make installed PWAs pick up new versions, and add a Reload button to the connection settings panel.

An installed PWA is a hash-routed SPA and almost never issues a `navigate` request, so the service worker's skipWaiting-on-navigate trick never fired and a freshly deployed worker stayed stuck in the `waiting` state. The idle-gated update check also rarely ran right after a relaunch, so the "new version available" popup never appeared. The service worker registration now calls `registration.update()` immediately and on every `visibilitychange` to visible (relaunch / tab re-show), so the manual update popup is surfaced. The manual popup is kept (no silent auto-update).

Also adds a Reload button to the web app's connection settings panel for forcing a fresh page load.
