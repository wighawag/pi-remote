---
"wherever-dev": patch
---

Fix the composer showing the web-search input while a session is still loading.

The bottom composer decided it was in "search mode" purely from `!sessionFile`, ignoring the loading/resyncing/hash state. So during a session open (spinner showing "Loading session..." in the message area) the composer would render the search text box and "Search" button, an inconsistent, confusing state. Search mode is now derived from a single shared `isSearchActive` helper that also treats a session that is loading, resyncing, or targeted by the URL hash as "not the search state", so the composer and the message area always agree.

Also adds a `vitest` unit-test tier to the `web` package covering the view-mode logic.
