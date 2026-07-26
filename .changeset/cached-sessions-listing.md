---
"wherever-dev": patch
---

Fix session loading getting stuck while the console fills with `/sessions` requests.

`GET /sessions` rebuilt the whole session list from scratch on every request: a synchronous `readFileSync` + per-line `JSON.parse` of EVERY session `.jsonl` on disk. On a real sessions directory (~2,800 files / 1.1 GB / 341k JSON lines) that is ~6.9s of work on the single Node thread, so the WebSocket could not deliver `session_created` / `message_history` for the session being opened. The list was also refetched constantly, because the server broadcast `sessions_updated` on every `message_end` (per message, many per turn) and every client answered each broadcast with a full-list fetch. Together: a flood of multi-second requests, an event loop pinned by them, and a "Loading session..." spinner that could hang past the client's 12s load watchdog.

- **Cached, incremental scan** (`scanDiskSessions`): each file's parsed listing info is cached against its `(mtime, size)` stamp, so a repeat scan only re-reads what actually changed; the folder cwd probe is cached per directory; entries for deleted sessions are evicted. Cold pass ~6.9s, warm pass ~90ms.
- **Non-blocking**: the scan is fully async and yields to the event loop between parses (worst measured event-loop lag during a cold pass: 29ms, vs the whole ~7s previously). Concurrent requests for the same view share one pass, and the cache is warmed in the background at startup.
- **Fewer broadcasts**: `sessions_updated` now fires on `agent_end` only (not `message_end`) and is leading+trailing throttled at 2s, so structural changes stay instant but bursts collapse into one broadcast. Deleting a whole folder no longer triggers one full-list refetch per deleted session.
- **No stranded promise**: `fetchSessions()` queued a resolver on the in-flight path that nothing would ever settle, so `await fetchSessions()` during an in-flight fetch could hang forever.
- **Quieter logs**: the per-request `/sessions` log line now only appears when a pass did real parsing work.
- **Lower memory**: the capped first-message preview is flattened, so caching it cannot pin the full (often huge) first message via a V8 sliced string (~33 MB retained -> ~3 MB).
- **Test isolation**: `WHEREVER_CONFIG_DIR` overrides the config directory, and the harness sets it, so an isolated test server no longer reads the developer's real `~/.wherever/config.json` (whose `sessions.ignore` could hide the harness's own sessions).

Also resolves a session by short ID/name through the same cached scan instead of `SessionManager.listAll()`, which re-read every session file just to resolve one deep link.
