# Plan: Search Mode for pi (terminal + browser via wherever)

**Status:** Planned, NOT yet implemented. Written 2026-06-14.

## Goal

A "search mode" for pi that works the same from the terminal and from the
browser (via wherever):

- From a phone browser: tap a search bar at the top of the wherever dashboard,
  ask a question, get a current, cited answer.
- From the terminal: a `pisearch` command gives the same experience.
- The search behaviour lives in a versioned, reusable skill, symlinked into
  `~/.agents/skills/` (matching the existing skill-symlink pattern).

The user should not need to open Google/DuckDuckGo themselves; wherever becomes
the search entry point.

## Verified context (checked against real files/output, 2026-06-14)

- **Skills are symlinks**: `~/.agents/skills/<name> -> <repo>/skills/<name>`
  (e.g. `setup -> .../agent-runner/skills/setup`). Confirmed via `ls -la`.
- **pi discovers skills from `~/.agents/skills`**: confirmed in
  `~/.pi/agent/pi-debug.log` (`auto (user) ~/.agents/skills/setup/SKILL.md`).
- **web_search / web_fetch already exist** via `@ollama/pi-web-search` (listed
  in `~/.pi/agent/settings.json` packages). Endpoints:
  `localhost:11434/api/experimental/web_search` and `.../web_fetch`. Error
  handling in that package: HTTP 401 -> "Run `ollama signin`"; ECONNREFUSED ->
  "Make sure Ollama is running". REUSE these tools, do NOT reimplement.
- **pi CLI flags**: `--skill <path>` exists (can preload a skill dir);
  `--append-system-prompt <text>` can take file contents. So `pisearch` can
  explicitly preload the skill.
- **Shell**: `$SHELL=/usr/bin/fish`, but the installer must be shell-agnostic
  (bash/zsh/fish/...).
- **wherever config**: `~/.wherever/config.json`, typed by `WhereverConfig` in
  `server/src/session-pool.ts`. Loaded by `getWhereverConfig()`. Existing keys:
  `gitInitDefault`, `remoteRepoRules`, `commonFolders`, `speech`, `uploads`.
- **`GET /config`** (`server/src/index.ts` ~line 429) returns
  `{gitInitDefault, uploadMethod}`. Frontend reads it in `fetchConfig()`
  (`web/src/lib/session-store.ts`) into stores.
- **Session create + message** already exist in `@wherever-dev/client`:
  `createSession(cwd, model, gitInit, createRemote, repoVisibility)` then, on the
  `session_created` event, `sendMessage(text)`. So a "search" = create a fresh
  session in the search folder, wait for `session_created`, send the query. No
  WebSocket protocol/server changes needed for that part; it is pure frontend
  orchestration in `web/src/lib/wherever.ts`.
- **createSession already supports remote-repo creation** via the
  `createRemote` + `repoVisibility` args, wired through to
  `sessionPool.createNewSession(...)`. So "create a private git remote for the
  search folder" reuses existing plumbing.

## Decisions (from the user)

1. **No default search folder.** The folder path must be set explicitly in
   `~/.wherever/config.json`. Once it is set, wherever may create the folder
   **on demand** (first search) if it does not exist. Add a second config flag
   for whether a git remote should be created for the search folder: **off by
   default**, and when on it must always be **private**.
2. **CLI installer** lives at `scripts/pisearch/` in the wherever repo. It
   **writes to the detected shell rc**, but must be easy to remove: print clear
   instructions (and/or a marked block) explaining how to undo it.
3. **Search bar** goes in the **top bar** of the dashboard and is **focused on
   first load**.
4. **Model**: search sessions use the **server default** model.

## Implementation outline

### Piece 1 - The skill (safe dirs)
- Create `skills/web-search/SKILL.md` in the wherever repo (new `skills/`
  folder; this is its home repo for now).
- Symlink: `ln -s ~/dev/github/wighawag/pi-remote/skills/web-search
  ~/.agents/skills/web-search`. Verify it resolves and pi lists it.
- Skill content (follow `write-a-skill` conventions; SKILL.md < ~100 lines):
  - **Triggers**: question-style requests, "search for", "what's the latest",
    "look up", "find current info on", or being launched in the dedicated
    search workspace.
  - **Behaviour**: lead with `web_search` first (not coding work). Open the most
    promising 1-3 result URLs with `web_fetch` to verify before answering,
    rather than trusting snippets. Prefer current/recent sources; weight
    recency for time-sensitive questions.
  - Answer the actual question directly and concisely, then list the source
    URLs used. Do NOT start a coding task or edit files unless explicitly asked.
  - If Ollama is unreachable (ECONNREFUSED / 401), tell the user to start Ollama
    / run `ollama signin`; do not silently fail.

### Piece 2 - Config (safe dir: ~/.wherever)
- Add to `~/.wherever/config.json` (merge, never clobber existing keys):
  - `searchFolder`: string (NO default; user sets it).
  - `searchCreateRemote`: boolean, default `false`. When `true`, the on-demand
    folder creation also provisions a **private** remote (visibility forced to
    `private`).
- `getWhereverConfig()` already auto-creates a default config if missing; the
  merge logic must preserve `gitInitDefault`, `remoteRepoRules`,
  `commonFolders`, `speech`, `uploads`.

### Piece 3 - wherever SOURCE edits (approved)
- `server/src/session-pool.ts`: add `searchFolder?: string` and
  `searchCreateRemote?: boolean` to `WhereverConfig`.
- `server/src/index.ts`: include `searchFolder` (tilde-resolved) and
  `searchCreateRemote` in the `GET /config` response. Folder creation on demand
  can reuse the existing `createNewSession(cwd, model, gitInit, createRemote,
  repoVisibility)` path (gitInit/createRemote driven by config;
  repoVisibility forced to `'private'`).
- `web/src/lib/session-store.ts`: add `searchFolderStore` (+ a
  `searchCreateRemoteStore` if needed); populate them in `fetchConfig()`.
- `web/src/lib/wherever.ts`: add `runSearch(query)` that:
  1. creates a session in `searchFolder` (with `createRemote`/`private` per
     config), then
  2. on `session_created`, sends `sendMessage(query)`.
- `web/src/routes/+page.svelte`: add a **search bar in the top bar**, visible
  when connected and `searchFolder` is configured; **autofocus on first load**.
  Submitting calls `runSearch` and opens the new session. Each search creates a
  new session (they appear in the sidebar grouped under the search folder).
  Consider a lightweight way to view search sessions independently (they already
  group by `cwd` in `SessionBrowser`).
- Add a **changeset** (`.changeset/*.md`, `"wherever-dev": minor`) per repo
  AGENTS.md. (Server + web changes -> `wherever-dev`; web is private and served
  by `wherever-dev`. Do NOT use `@wherever-dev/web`.)

### Piece 4 - Portable CLI installer (approved)
- `scripts/pisearch/install.sh`: shell-agnostic. Detects bash/zsh/fish, installs
  a `pisearch` command that `cd`s to the configured search folder (read from
  `~/.wherever/config.json`) and runs `pi --skill <web-search skill path>`.
- Writes to the detected shell rc inside a clearly **marked block** (e.g.
  `# >>> pisearch >>>` ... `# <<< pisearch <<<`), and prints exact removal
  instructions. Optionally a `scripts/pisearch/uninstall.sh`.
- Show the script before writing; run only with explicit user go-ahead.

## Constraints (reaffirmed)
- Reuse `web_search`/`web_fetch`; do not reimplement.
- No commits in any repo without explicit ask.
- Skill authored in the wherever repo, symlinked into `~/.agents/skills`
  (do not author directly inside `~/.agents/skills`).
- Writes outside `~/.pi`, `~/.agents`, `~/.wherever`, and the new search folder
  must be shown as diffs and approved first. (wherever source edits are
  approved in principle; still show diffs.)

## Open items to confirm at implementation time
- The actual search folder path (user provides; no default).
- Whether to add a dedicated "search sessions" view/filter, or rely on existing
  folder grouping in `SessionBrowser`.
- Installer: confirm rc-file target per shell and the exact marker block.

---

## Separate, related plans (NOT part of search mode; tracked here so they are not lost)

These are distinct work items the user flagged. Each deserves its own plan/slice.

1. **Prerendering staleness on first load.** Because the web app is prerendered,
   first load shows the sessions list / state captured at build time. Likely fix:
   remove prerendering (or make the session list strictly client-fetched on
   mount and never prerendered). Investigate SvelteKit `prerender` settings in
   `web/`.
2. **Queued messages lost on unqueue.** When a queued message is unqueued, it is
   deleted instead of being pasted back into the editable text input field.
   Expected: restore the text into the input for editing/resending.
3. **Slow load for long sessions.** Long sessions take a while to load.
   Investigate incremental/virtualized history loading or pagination.
4. **Firefox Android reload-on-resume.** On Firefox (Android), locking the
   screen and returning reloads the page, which is slow and annoying. Investigate
   whether anything can mitigate (service worker / state restore / bfcache).
