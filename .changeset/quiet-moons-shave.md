---
"wherever-dev": patch
---

Fix a session opened from a URL hash deep link (`https://host/#<sessionId>`) hanging forever on "Loading session...", while the same session opened instantly from the sidebar.

The sidebar joins a session by FILE path, but the URL hash carries the session ID. `session_load` accepts either (the server resolves an ID to its file) yet always replies with the resolved file path. The client's superseded-load guard matched a `session_created` reply against the pending load target by file path only, so an ID-issued load never recognised its own reply: it was dropped as a stale/superseded load, no session ever became active, and the hash-driven spinner never cleared. The pending load target now matches its reply by session file OR session ID, while still rejecting late replies for genuinely abandoned loads.
