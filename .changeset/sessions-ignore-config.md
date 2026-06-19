---
"wherever-dev": patch
---

Add a `sessions.ignore` config option to exclude session folders from the dashboard list and speed up `/sessions`.

The session list was built by reading and JSON-parsing **every** session file on disk on every `/sessions` request (to compute each session's first-message preview). With hundreds of sessions, including large piles of throwaway agent scratch sessions (e.g. under `/tmp`), this made the list noticeably slow to load.

You can now set, in `~/.wherever/config.json`:

```json
{ "sessions": { "ignore": ["/tmp/**", "~/.agent-runner/**"] } }
```

Any session whose resolved working directory matches one of these globs is excluded from the list. Crucially, because all sessions in one on-disk folder share a working directory, a matching folder is detected by reading only its first file's header (not its body) and is then **skipped before its file bodies are read**, so ignored sessions no longer cost anything to scan. Globs support `*` (does not cross a path separator), `**` (crosses separators), and `?`; `~` is expanded to home; and a pattern ignores both the directory itself and everything nested under it. When `sessions.ignore` is empty or omitted, behaviour is unchanged (the existing fast path is used).
