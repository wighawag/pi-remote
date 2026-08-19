---
"wherever-dev": minor
---

Conversation search: find anything ever said in any session, and jump into it.

- **Server**: new `GET /search?q=<FTS5>&view=default|readonly&limit=` (same token gate as the other API routes), backed by the [memonaut](https://github.com/wighawag/memonaut) index (`~/.local/share/memonaut/index.db`). Opened strictly read-only; wherever never writes to it. Results carry the absolute transcript path normalized exactly like `/sessions`, so a hit is directly clickable into the existing session view, and every fork carrying a match in shared history is returned (most recently active first, with per-thread `+N after` counts) instead of being collapsed to one.
- **Never blocks the event loop**: the endpoint never builds or syncs the index in-process (memonaut's indexer is synchronous, ~40 s on a real corpus, which would freeze every WebSocket client). A missing index answers `status: "not-indexed"` telling you to run `recall index`; incremental catch-up is delegated to a TTL-gated child process, fired after the response and never awaited (`conversationSearch.autoSync` / `conversationSearch.syncIntervalMs` in `~/.wherever/config.json`).
- **Privacy**: the two axes compose in one place. memonaut's `private` transcripts are never returned, and wherever's `sessions.ignore` sessions are dropped from search on every view, so search can never surface what the dashboard hides; `sessions.readOnly` folders mirror `/sessions` and stay on the read-only view.
- **Web**: a "Search conversations" panel in the sidebar (and from the read-only page), with highlighted snippets, fork-aware result grouping and click-through to the session. The existing session-list filter box is unchanged, plus a "Search all conversations for …" hand-off.
