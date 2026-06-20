---
"wherever-dev": patch
"@wherever-dev/client": patch
---

Fix the sidebar getting stuck on "Loading session..." when switching sessions, where the previous session would close but the sidebar stayed open over a hanging spinner and tapping other sessions appeared to do nothing.

- client: add an atomic `switchSession()` that leaves the current session (if any) and loads the target in a single step. The UI previously did `leaveSession()` then `joinSession()` separated by a 100ms `setTimeout`; that gap could strand the loading state if a tap landed mid-switch or a leave's follow-up load never fired. `switchSession()` always (re)arms the load watchdog for the new target, so a superseded or lost load can never strand the UI and the latest tap always wins.
- client: shorten the session-load watchdog from 20s to 12s so a genuinely stuck load surfaces a recoverable error (and frees the UI) sooner.
- web: the sidebar now closes as soon as a load is in flight (loading/resync), not only once the session id is set. A stalled load no longer leaves the sidebar open on top of the spinner.
- web: the sidebar session click and the URL-hash change handler both use the atomic `switchSession()` path, removing the fragile leave -> setTimeout -> join dance.
