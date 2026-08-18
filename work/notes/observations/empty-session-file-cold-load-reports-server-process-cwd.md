---
title: A cold load of a session file with no entries reports the SERVER's process cwd
type: observation
status: spotted
spotted: 2026-08-18
---

## What was seen

While building a regression test for the folder-conflict fixes (`server/test/folder-conflict-continue.test.ts`), a session that was created but never given a turn came back from a cold `session_load` with the wrong `cwd`:

```
LOAD {"pending":true,"readOnly":false,"fc":false,
      "cwd":"/home/wighawag/dev/github/wighawag/wherever/server", ...}
```

The session's real cwd was the harness workspace (`/tmp/wherever-gate-*/workspace/cold`); the reported value was the cwd of the **server process**. The same session, created and loaded while resident, reported the correct cwd. Adding a single turn before the eviction (so the session file actually has entries) made the cold load report the right cwd.

## Where

- `SessionPool.readSessionMeta` (`server/src/session-pool.ts`) is the cheap header-read used by the fast-first load path in `case 'session_load'` (`server/src/index.ts`). The fallback when the file carries no recorded cwd appears to be the process cwd rather than an explicit "unknown".

## Why it matters

`meta.cwd` is not cosmetic on that path. It feeds:

- `pool.detectConflict(meta.sessionFile, meta.cwd)` -> whether a folder conflict is raised at all (an empty session in an occupied folder silently reports NO conflict, so a second driver is never warned);
- `client.pendingCwd`, which `folder_conflict_continue` uses to check the `sessions.readOnly` rule before the attach completes;
- the `cwd` echoed to the client in `session_created`, which the client stores as `activeCwd` and uses to filter live `folder_conflict` updates.

So a session that was opened and abandoned before its first turn can, after eviction, be reattached with a cwd belonging to whatever directory the server was started in. If that directory happens to match a `sessions.readOnly` glob (or another live session's folder), the derived read-only/conflict verdicts are simply wrong.

## Not investigated

- Whether the agent BUILD path (`loadSession`) recovers the correct cwd afterwards (the tracked session's cwd looked right once resident, so the divergence may be limited to the pre-build window).
- Whether the session file's directory name (which encodes the cwd, e.g. `--tmp-...-workspace-cold--`) could be used as a fallback instead of `process.cwd()`.

## Refs

- Discovered while fixing the read-only folder-conflict dead ends (see `.changeset/phantom-viewer-new-session.md`).
- The test now seeds a real turn before eviction specifically to dodge this, with a comment saying why: `server/test/folder-conflict-continue.test.ts`.
