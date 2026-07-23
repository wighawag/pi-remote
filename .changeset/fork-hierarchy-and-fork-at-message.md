---
"wherever-dev": minor
---

Fork sessions at a specific user message, and show the fork hierarchy in the sidebar.

The session list now renders forked sessions as a tree: a session created by forking is nested (indented, with a ↳ marker) under the session it was forked from. This mirrors pi's own session selector and is driven by each session's `parentSession` header, which the `/sessions` endpoint now surfaces as `parentSessionPath`.

Every user message in a conversation gets a "Fork" action. Clicking it forks the session BEFORE that message (pi's default `position: 'before'`), creating a new branched session that keeps everything up to just before the chosen message and records the source as its parent. The web then switches to the new session and pre-fills the composer with the forked-at message's text, ready to edit and resend, exactly like `/fork` in the pi CLI.

Implementation: user history messages now carry their source tree `entryId`; a new `session_fork` -> `session_forked` WebSocket exchange creates the branched file server-side (via the SDK's `createBranchedSession`) and returns the new path plus the pre-fill text; the client loads it through the normal session-load path. No live agent is built until the forked session is opened.
