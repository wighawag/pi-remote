---
"wherever-dev": patch
---

Allow attaching files to the first message of a web search. The search composer (shown when no session is open) now has the 📎 button: picked files are held in the browser, uploaded as soon as the search creates its session, and referenced from the query as `[Uploaded file: ...]` lines. A search with files but no text is valid, upload failures still send the query and surface as a session error, and files are dropped if the composer leaves search mode. The uploaded-file message shape is now a shared, unit-tested helper (`web/src/lib/core/attachments.ts`) used by both the chat and search paths.
