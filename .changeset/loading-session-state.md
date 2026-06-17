---
"wherever-dev": patch
---

Fix session selection showing the "New Session Started" empty state and not scrolling to the bottom while an existing session loads.

- Added a dedicated `loadingSession` state flag that is set the moment a `session_load` is requested and cleared when its `message_history` (or an error/conflict/disconnect) arrives. This distinguishes "opening an existing session" from "a brand new empty session", so the chat view now shows a "Loading session..." spinner instead of "New Session Started" during the gap between the `session_created` and `message_history` websocket messages.
- Scroll-to-bottom now also fires on the `loadingSession` true→false edge (when the history actually renders) using a settle loop across a couple of animation frames plus delayed retries, so freshly opened sessions reliably land at the bottom even when tall markdown/code content keeps growing for a few frames after mount.
