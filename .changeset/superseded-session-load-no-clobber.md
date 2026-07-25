---
"@wherever-dev/client": patch
"wherever-dev": patch
---

Fix a slow-loading session suddenly replacing the one you switched to. While a session was still loading, tapping a different session in the sidebar could let the old session's late reply clobber the one you were now looking at. The client now stamps every `session_load` with its target file and rejects a stale `session_created` / `message_history` for a session it already switched away from (the latest tap wins), so a superseded load can no longer take over the active view or strand the loading spinner.
