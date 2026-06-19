---
"wherever-dev": patch
---

Shrink and de-thrash the `/sessions` payload so the dashboard loads fast with many sessions.

The session list shipped the **entire, untruncated first message** of every session (often huge: pasted prompts, PRDs, specs), even though the sidebar only renders a ~40-char snippet. With hundreds of sessions this made `/sessions` multi-megabyte and slow, and it was refetched aggressively.

- **Server (shrink):** `listSessions()` now caps `firstMessage` to a short, whitespace-collapsed preview (160 chars) at a single choke point, so every listing path ships a small preview. The field name is unchanged (now documented as a capped preview); the sidebar's display and filtering work as before. Measured against a real ~900-session store, the first-message portion of the payload dropped roughly 33x (multi-MB to ~140 KB).
- **Web (de-thrash):** `fetchSessions()` no longer runs two fetches at once, collapses any requests arriving while a fetch is in flight into a single trailing re-fetch, and caps its debounce so a continuous stream of `sessions_updated` events (one per agent turn) can no longer pull the whole list repeatedly or postpone the fetch indefinitely.

This composes with the `sessions.ignore` / `sessions.readOnly` options (which cut how many sessions are scanned/listed at all): together the default session list is now small and quick to load.
