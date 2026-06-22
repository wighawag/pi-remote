---
title: Full-text session search (index, CLI, endpoint, frontend, deep-linking)
slug: session-search-index
needsAnswers: true
briefAfter: [better-sqlite3-adapter]
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `CONTEXT.md` + `docs/` (decisions) + the code; remaining work: the tasks sliced from this brief.

## Problem Statement

Sessions accumulate fast under `~/.pi/agent/sessions/` (already ~986 `.jsonl` files, ~388 MB, one folder per project keyed by encoded cwd). Finding a past conversation is currently nearly impossible:

- The web "search" in `SessionBrowser.svelte` is **not search**. It is a client-side substring filter over `firstMessage` (a 160-char preview shipped in `/sessions`) and the folder name. You **cannot** find a session by anything said in the middle of a conversation, only by the first user message's opening characters or the project name.
- There is no CLI to search sessions either.

The user wants to "easily search for a particular conversation" from the web frontend, with a CLI equivalent, including good ranked results and the ability to jump to the matching message.

## Solution

A server-side **full-text search index** over all sessions, with a **shared index core** consumed by both a **web search UI** and a **CLI**, so search is built once and surfaced two ways.

- **Index core** parses each session's messages into searchable, role-tagged text and stores them in a SQLite **FTS5** index for ranked (BM25) phrase/multi-term search with highlighted snippets. The index is incremental (sessions are append-only files; only changed/new files are re-parsed) and stays live as sessions are written.
- **Storage is abstracted via `remote-sql`** (the `RemoteSQL` interface: `prepare/bind/all/batch`), with the new **`remote-sql-better-sqlite3`** adapter as the default local backend (FTS5). LibSQL/Turso is a possible future remote backend; **D1 is explicitly unsupported** (no FTS5). Search SQL has an `fts5` path; a `like` fallback exists only for backends without FTS5 and is not the primary experience.
- **CLI** (`search`, `index`/`--rebuild`, `stats`, plus a `--raw`/grep escape hatch over `rg`) proves ranking and snippet quality against the real sessions before any UI work.
- **Search endpoint + WS protocol message** return rich, rankable hits (project, date, title, score, match count, highlighted snippet, who-said-it, and the matched message's offset).
- **Frontend** replaces the substring filter with a proper ranked result display, and (as a second increment) **deep-links** a result click to the matching message inside the session.

## User Stories

### Index core

1. As a user, I want every session's user and assistant message text indexed for full-text search, so that I can find a conversation by anything that was said in it, not just the first message.
2. As a user, I want search results **ranked by relevance** (BM25), so that the conversation I actually want surfaces at the top instead of a flat file-ordered list.
3. As a user, I want the index to update incrementally and stay current as sessions are written/appended, so that recent conversations are searchable without a manual rebuild. (Sessions are append-only; track per-file `mtime`+`size` and only re-parse changed/new files.)
4. As a user, I want the first full index build of ~1000 sessions to complete in seconds, and incremental updates to be effectively instant, so that search never feels like a chore.
5. As a maintainer, I want the index core to reuse the existing JSONL parsing (`buildDiskSessionInfo` / `getSessionHistory` in `session-pool.ts`) as the single source of truth for how a session is read, so that listing and search never diverge.
6. As a maintainer, I want the index core to honor the existing `sessions.ignore` / `sessions.readOnly` config, so that ignored sessions are not indexed and read-only sessions are searchable but clearly marked (matching the dashboard's listing semantics).
7. As a user, I want search to default to **user + assistant text**, with an opt-in to also include thinking blocks and tool calls/results, so that results stay clean by default but the noise is reachable when I need it.
8. As a maintainer, I want the index core to talk to storage **only through the `remote-sql` `RemoteSQL` interface**, with `remote-sql-better-sqlite3` as the default local adapter, so that the same core can later run against a remote LibSQL/Turso backend without a rewrite.
9. As a maintainer, I want a backend **capability flag** (`fts5` vs `like`): FTS5 backends (local better-sqlite3, LibSQL) use `MATCH`/`bm25()`/`snippet()`; a non-FTS5 backend degrades to `LIKE` with a clear loss-of-ranking warning. D1 is not a supported target.
10. As a user, I want to filter searches by project (cwd), date range, and role, so that I can narrow "where did I discuss X in project Y last month".

### Result shape (the make-or-break part)

11. As a user, each result must show enough to **recognize the conversation without opening it**: project, session title (folder name + session name or first user message), date, and message count.
12. As a user, each result must show the **matching snippet(s) with the query terms highlighted**, tagged with **who said it** (me vs assistant) and the rough position ("message 14 of 60"), so that I know whether the hit is my question or the answer.
13. As a user, I want a **relevance score and a multiple-match indicator** ("3 matches"), so that a conversation that discussed the topic repeatedly ranks and reads above an incidental mention.
14. As a user, I want the snippet to be the **context window around the actual match** (a line or two before/after, term-highlighted, role-tagged), not just the first message, so that the snippet is genuinely informative.
15. As a user, I want each hit to carry the **matched message's offset**, so that the frontend can deep-link to it.

### CLI

16. As a CLI user, I want `pi-sessions search "<query>"` (name TBD) to print ranked results with project, date, title, highlighted snippet, who-said-it, match count, and the file path, so that I can find conversations from the terminal.
17. As a CLI user, I want `index`/`index --rebuild` and `stats` subcommands, so that I can build/rebuild the index and inspect its size/coverage.
18. As a CLI user, I want a `--raw` (grep) mode that shells out to `rg` over the raw `.jsonl` (including tool output and thinking), so that I have an escape hatch for literal-bytes search and a zero-state fallback when the index is missing/stale.
19. As a CLI user, I want filters (project/cwd, date range, role, include-thinking/tools) mirroring the index core's capabilities, so that the CLI and the web surface the same search power.

### Endpoint + protocol

20. As a frontend developer, I want a `GET /sessions/search?q=...&cwd=...&from=...&to=...&role=...&includeThinking=...` endpoint returning ranked hits in the rich shape above, so that the web UI can query search over HTTP.
21. As a frontend developer, I want a WebSocket request/response pair (`sessions_search` -> `sessions_search_result`) matching the existing protocol style in `protocol.ts`, so that search fits the live connection the dashboard already uses.
22. As a maintainer, I want the search endpoint and CLI to share the **same index core**, so that there is no duplicated search logic.

### Frontend result display

23. As a web user, I want to type a query in the session browser and get **ranked results grouped by project**, replacing today's project-tree-only substring filter, so that the most relevant conversations appear first.
24. As a web user, I want each result rendered with project, date, title, highlighted snippet, who-said-it, and match count (the result shape above), so that I can recognize the conversation at a glance.
25. As a web user, I want results to debounce as I type and feel snappy, with the existing instant local filter retained for very short queries, so that search is responsive.
26. As a web user, clicking a result should **open that session**, so that I can continue or read it.

### Deep-linking (second frontend increment)

27. As a web user, clicking a result should open the session **scrolled to the matching message** (not just the top/bottom), with that message briefly highlighted, so that I land on the hit inside a long conversation.
28. As a maintainer, I want "open at offset N" implemented as a **load-window-around-offset** variant of the existing windowed history (`getSessionHistoryWindow(limit, beforeOffset)` already returns `{messages, totalCount, offset}` and the protocol already carries `offset`/`totalCount`), plus a `scrollToOffset(n)` in `ChatMessageList.svelte` reusing its existing scroll-anchoring logic, so that deep-linking builds on the windowing path rather than around it.

## Open Questions (needsAnswers)

These were raised and consciously deferred; resolve before slicing the affected tasks:

1. **Index location:** `~/.pi/agent/sessions/.search-index.db` vs `~/.wherever/sessions-index.db`? (Author leans `~/.wherever/` to keep pi's dir clean and align with wherever's config home.)
2. **better-sqlite3 adapter placement:** the adapter is being added to `~/dev/github/wighawag/remote-sql` as `remote-sql-better-sqlite3` (decided). Confirm this brief's index core depends on that published/workspace package rather than vendoring a local adapter.
3. **CLI name and packaging:** `pi-sessions`? `wherever search`? Where does the bin live (the `server` package?) and how is it exposed to the user?
4. **Index scope default confirmation:** default to user+assistant only, thinking/tools opt-in (assumed in stories 7/18/19) — confirm.
5. **Refresh trigger:** re-index on the existing `sessions_updated`/session-write path, on a debounce timer, on first search after a staleness check, or a combination? (Affects how "live" search feels vs. cost.)

## Implementation Decisions

- **Shared `SessionIndex` core** in `server/src`, storage behind the `remote-sql` `RemoteSQL` interface; default local backend = `remote-sql-better-sqlite3` (FTS5).
- **Schema (indicative):** a `sessions` row per file (`id`, `path`, `cwd`, `name`, `created`, `modified`, `message_count`, `first_user_message`, plus `mtime`+`size` for incremental detection) and an FTS5 table of message text keyed by session, with a `role` column to filter thinking/tool noise by default. `messageOffset` stored per indexed message so hits can deep-link.
- **Async core:** because `batch()` is async (and would be over a network), the core API is async end to end — which is also the right shape for the endpoint.
- **Incremental indexing:** compare stored `mtime`+`size` per path; only re-parse new/changed files. Bulk writes via `batch()` (chunked multi-row inserts, one round trip per chunk) to stay efficient and remote-friendly.
- **Capability-gated search SQL:** `fts5` path (`MATCH` + `bm25()` ordering + `snippet()`/`highlight()`) vs a `like` fallback path, selected by a backend capability flag. D1 unsupported.
- **Result contract:** `{ sessionId, path, cwd, name, created, score, matchCount, snippet, role, messageOffset }` — shared by CLI, HTTP endpoint, and WS result.
- **Reuse, don't fork, the parsing:** `buildDiskSessionInfo` / `getSessionHistory` are the source of truth; the indexer feeds from them.
- **Deep-linking:** add a "load window containing offset N" history variant + `scrollToOffset` in `ChatMessageList.svelte`, reusing `pendingAnchorFromBottom`/`handleLoadMore` scroll-anchoring; results carry `messageOffset`.
- **Staging:** (1) core + better-sqlite3 adapter dependency + CLI (prove ranking/snippets on real sessions); (2) endpoint + protocol around the validated result contract; (3) frontend result display; (4) deep-linking. Each stage independently verifiable.

## Testing Decisions

- **Index core (highest-value seam):** point the indexer at a fixture sessions tree (a handful of crafted `.jsonl` files), build the index, and assert search behaviour through the public core API: ranking order for a multi-term query, snippet contains highlighted terms, role filtering (thinking/tools excluded by default, included when opted in), cwd/date filters, and `matchCount`. Run against the in-memory better-sqlite3 adapter for speed.
- **Incremental update:** index, append a message to one session file (bump mtime/size), re-index, assert only that file was re-parsed and the new text is searchable.
- **Capability fallback:** assert the `like` path returns matches (unranked) when FTS5 is reported unavailable, with the documented degradation.
- **Result contract:** a search hit carries a valid `messageOffset` that, fed to the windowed-history "load around offset" query, returns a window containing the matched message (proves deep-linking end to end without the UI).
- **CLI:** smoke-test `search`/`stats` output shape and the `--raw` grep fallback path.
- **Endpoint/protocol:** request/response shape conforms to the result contract; reuses the core (no parallel search logic).
- **Frontend:** component-level test that a search response renders the rich result fields and that a result click emits an open-at-offset intent (deep-linking increment).
- Prior art for parsing/seams: `session-pool.ts` (`getSessionHistoryWindow`, `buildDiskSessionInfo`), `protocol.ts` (message-type style), `ChatMessageList.svelte` (scroll anchoring).

## Out of Scope

- The `better-sqlite3` adapter itself (separate brief in `remote-sql`: `better-sqlite3-adapter`; this feature depends on it — see `briefAfter`).
- D1 / remote backends (D1 unsupported; LibSQL/Turso remote is a future possibility, not built here).
- Semantic / embedding-based search; this is lexical FTS5 only.
- Cross-machine index sync.
- Re-architecting the session storage format; we index what pi already writes.
- Indexing non-session artifacts (`.md`, `.json` files in the sessions tree).

## Further Notes

- Why not grep as the primary engine: grep cannot rank, does not understand session structure (matches inside escaped JSON, tool output, thinking, base64), has no phrase/field/multi-term queries, and re-scanning 388 MB per keystroke is the wrong shape for a live search box. Grep remains as the CLI `--raw` escape hatch and zero-state fallback.
- The current frontend gap (substring filter over a 160-char preview) is the concrete motivation; story 23 is the direct fix.
- `getSessionHistoryWindow` already returning `{messages, totalCount, offset}` and the protocol already carrying `offset`/`totalCount` is what makes deep-linking a modest add rather than a windowing rewrite.
- Remember the repo's changeset rule (`AGENTS.md`): web/server changes -> `wherever-dev`; do not touch private `web` package name.
