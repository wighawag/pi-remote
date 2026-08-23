---
"wherever-dev": patch
---

Fix "new conversation here" landing you back in an existing conversation.

Asking for a new session in a folder that already had a live viewer did not create anything: the server attached you read-only to the session already running there and raised the "another client is active in this folder" banner. The conversation you were handed was often the one you were already reading (any second tab, or your own socket that dropped silently and has not been reaped yet, counts as another viewer), and "Continue anyway" could only unlock that old conversation, never give you the new one you asked for.

`session_new` now always creates a new session (`SessionPool.createNewSession(..., forceNew)` bypasses the reuse-an-occupied-folder shortcut). When the folder really is shared, the folder-conflict banner is raised on the NEW conversation, which starts read-only until "Continue anyway" - so the warning stays, but it now sits on the conversation you asked for. `POST /session/new` keeps its old reuse behaviour.

Also stops a second viewer of the SAME conversation being counted as a folder conflict, which could pin the banner (and its read-only) on with nothing left to resolve it.
