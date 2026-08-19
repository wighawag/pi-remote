---
"wherever-dev": patch
---

Stop loading whole session transcripts into memory: startup RSS on a 2 GB sessions directory drops from ~990 MB peak / 426 MB settled to 208 MB, and opening a large session no longer ratchets memory (or blocks the event loop).

The server read session `.jsonl` files by materializing them. The `/sessions` listing scan did `readFile(utf8)` + `split('\n')` + `JSON.parse` per line into a retained array, per file, and it runs at startup to warm the cache; every history read (`session_load`, `history_page`, `cli_register`) went through pi's `SessionManager.open()` (which loads and parses the whole file twice) and then mapped EVERY entry into a `HistoryMessage[]`, base64 tool images included, only to slice the last 60 off the end. On a real corpus (3,831 files / 2.0 GB, single transcripts up to 62 MB) that is hundreds of MB of transient objects per pass, and V8 never gives the heap high-water mark back, so the process grew until systemd-oomd killed it.

All of it now goes through a new streaming reader (`server/src/session-transcript.ts`) that finds newlines in the bytes, classifies each line from a bounded 512-byte head, and only ever materializes what the caller asked for. Tool results (most of a transcript's bytes) are counted and discarded without becoming strings. History is read as two bounded passes: one counts (and supplies the header, the current model and the total), the second stops as soon as the requested window is full, so paging back through a long session costs the same as reading its tail. `registerCliSession` reads the 8 KB header instead of the whole file for a session id. A file that cannot be read is skipped with a log line instead of failing the whole listing.

Measured on the same 2.0 GB corpus, built server, identical methodology:

- startup: peak RSS 990 MB -> 208 MB, settled 426 MB -> 208 MB (an empty sessions dir is 164 MB, so the corpus costs ~44 MB instead of ~260 MB)
- opening the largest session (59 MB, 1,780 messages): 401 ms of blocked event loop and ~130 MB RSS growth per open -> 71 ms, non-blocking; 150 consecutive opens plateau at ~340 MB with live heap flat at 39 MB (40 opens on the old path alone reached 825 MB)

Also in this change:

- New optional listing retention, both off by default and applied from the file's `stat` before any body is read: `sessions.maxAgeDays` and `sessions.maxSessions` in `~/.wherever/config.json`. Nothing is deleted and excluded sessions still open by path or short ID; they just are not listed. The server prints a one-line hint at startup when it lists more than 1,000 sessions with neither set.
- `wherever install` now bakes `MemoryHigh=1G` / `MemoryMax=1500M` into the systemd unit, so a memory problem can only take down (and auto-restart) that unit instead of pushing the whole machine into swap thrash. Tune with `--memory-high` / `--memory-max`, or drop them with `--no-memory-limits`; install prints how to verify systemd actually applied them (it silently ignores them without memory-controller delegation). launchd has no equivalent, so this is Linux-only.
- Fixed a race the streaming reads exposed: "Continue anyway" clicked immediately after a cold `session_load` was dropped when it landed before the load had recorded its cwd, leaving the client read-only with the banner's button already gone. The intent is now recorded regardless and re-evaluated at attach (the `sessions.readOnly` guard still applies).
- An unanswered `!sudo` password prompt (client vanished mid-prompt) is no longer retained forever: it is dropped when its session is evicted, and any entry past a 30-minute TTL is swept when the next prompt is armed.
