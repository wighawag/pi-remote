# Wherever - Project Context

**Created:** 2026-05-20  
**Location:** `/home/wighawag/dev/github/wighawag/wherever`

## Project Overview

Wherever is a TypeScript extension for the [pi coding agent](https://pi.dev) that provides HTTP/WebSocket server capabilities for remote control. It allows controlling pi from anywhere while maintaining full access to all local folders and tools.

## What Exists

### Core Files

- **`src/index.ts`** - Main extension server
  - HTTP server with REST API endpoints
  - WebSocket server for real-time streaming
  - Token-based authentication
  - Event broadcasting (agent lifecycle, tool execution, messages)
- **`src/client.ts`** - Reference WebSocket client
  - Command-line client for testing
  - Demonstrates WebSocket protocol usage
- **`docs/USAGE.md`** - Complete API documentation
  - WebSocket API reference
  - HTTP API reference
  - Example clients (JavaScript, Python, cURL)
  - Mobile usage options
  - Troubleshooting guide

### Web Applications & Extensions

- **`web/`** - SvelteKit dashboard app (mobile-friendly)
  - Real-time WebSocket connection to wherever-dev server
  - Chat interface, session browser, voice dictation
  - Served by the server at `/` when connecting to a server
  - Built to `web/build/`
- **`vscode/`** - Wherever VS Code Companion Extension
  - IDE-native Sidebar Chat GUI
  - Establishes local loopback with `@wherever-dev/client`
  - Integrated with VS Code commands and native theme variables
  - Direct editor actions: Open Document and side-by-side git diff view
- **`site/`** - Standalone marketing/info website
  - Landing page, features, install guide, architecture diagram
  - Built as a static site for GitHub Pages deployment
  - Independent from web/ — no shared code or dependencies
  - Built to `site/build/`
  - Deployed via `.github/workflows/deploy-gh-pages.yml`

### Configuration

- **`package.json`** - Dependencies and pi package manifest
  - Runtime: `ws` (WebSocket library)
  - Dev: TypeScript, tsx, @types/node, @types/ws
  - Pi package config for auto-discovery
- **`tsconfig.json`** - TypeScript configuration
  - ES2022 target, ESNext modules
  - Strict mode enabled
  - Output to `dist/`

### Documentation

- **`README.md`** - Quick start guide
- **`LICENSE`** - AGPL-3.0 License
- **`.gitignore`** - Standard Node.js ignores

## Technical Details

### Architecture

```
┌─────────────────┐         ┌──────────────────┐
│  Remote Client  │◄───────►│  Wherever Server │
│  (WebSocket)    │         │  (Extension)     │
│  (Web Dashboard)│         │                  │
└─────────────────┘         └────────┬─────────┘
                                     │
                              ┌──────▼──────┐
                              │  Pi Core    │
                              │  + Tools    │
                              └─────────────┘
```

```
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│  Web Browser     │◄────────│  wherever Server │────────►│  pi CLI          │
│  (Dashboard)     │  WS     │  (Extension)     │  Ext    │  (Agent + Tools) │
└──────────────────┘         └──────────────────┘         └──────────────────┘
```

```
┌──────────────────┐
│  Marketing Site  │
│  (GitHub Pages)  │
│  site/           │
└──────────────────┘
```

### Server Endpoints

**WebSocket:** `ws://host:port/ws?token=XXX`

- Real-time bidirectional communication
- Streams agent responses, tool events
- Accepts messages, abort commands

**HTTP REST:**

- `POST /message` - Send message to agent
- `GET /session` - Get session info
- `POST /session/new` - Start new session
- `POST /session/compact` - Trigger compaction
- `GET /health` - Health check (no auth)
- `POST /session/upload` - Upload a file from the client to the server
- `GET /session/download` - Download an agent-produced file to the client (see "File Download / Attachments" below)

### Service Install (`wherever install`)

The standalone server (`server/`, bin `wherever`) uses explicit verbs. `server/src/index.ts` dispatches on the first argv: `start` runs the server (server flags follow it; the `start` token is stripped from `process.argv` before `main()` so the existing flag parser is unchanged), `install` / `uninstall` / `service-status` (aliased `status`) route to `server/src/commands/install.ts`, and a bare `wherever` (or `help`) prints usage. An unknown verb prints usage and exits 1. The generated service unit invokes `wherever start ...`.

- **Linux**: systemd unit. Per-user (`~/.config/systemd/user/wherever.service`) by default, or system-wide (`/etc/systemd/system/wherever.service`) with `--system` (needs root). Enabled + started via `systemctl [--user] enable --now wherever`.
- **macOS**: per-user launchd LaunchAgent at `~/Library/LaunchAgents/dev.wherever.server.plist`, loaded via `launchctl`. `--system` is not supported.
- **Windows**: not supported yet; the command prints the manual steps.
- Server flags `--port` / `--host` / `--token` are baked into the service's `ExecStart` / `ProgramArguments`.
- **Pi config injection**: unless `--no-pi-config`, install adds `"npm:@wherever-dev/pi"` to the `packages` array in `~/.pi/agent/settings.json` (creating the file if missing) when not already present, backing up to `settings.json.bak` first.
- `--dry-run` prints the generated unit/plist and intended actions without writing anything.

### Authentication

- Optional token via `--remote-token` flag
- WebSocket: query param or Authorization header
- HTTP: query param or Authorization header
- Default bind: `127.0.0.1` (localhost only)

### Waiting-for-human Beep

Both the web frontend and the CLI bridge extension can play an inviting sound when the agent finishes and is waiting for a human message. Disabled by default on both, with a per-session toggle and a default-setting config (the per-session toggle overrides the default). The two surfaces are configured independently.

- **CLI extension** (`extension/src/index.ts`): plays a sound on the `agent_settled` event (fully settled, not between chained internal turns).
  - **Enable default**: `--remote-beep` flag OR `beep.enabled: true` in `~/.wherever/config.json` (the flag can only force-on; the config file is the way to enable-by-default without passing the flag). Default off.
  - **Per-session**: `/remote-beep [on|off]` (no arg toggles; enabling plays a sample). Resets to the configured default on each session start.
  - **Sound**: resolves, highest first: `--remote-beep-command` flag → `beep.command` in `~/.wherever/config.json` → auto-detected player + freedesktop/system chime (`pw-play`/`paplay`/`canberra-gtk-play`/`ffplay` + `complete.oga`, or `afplay` on macOS) → terminal bell `\x07` written to `/dev/tty` (falling back to stdout). The BEL goes to `/dev/tty` because pi's TUI owns stdout and can swallow an out-of-band byte; and many terminals (e.g. WezTerm on Linux) have a silent audible bell, which is why the command path exists.
- **Web frontend** (`web/src/lib/core/beep.ts` + `web/src/lib/wherever.ts`): a Web Audio soft two-note chime fires on the `isStreaming` true -> false edge. A 🔔/🔕 top-bar button toggles it per session; Connection Settings has a "Beep when the agent is waiting" checkbox (`beepDefault`) and an optional custom sound URL (`beepSoundUrl`, played via an `Audio` element with a Test button; blank = built-in chime). Both persist in the `wherever-config` localStorage entry. The per-session override resets when the active session changes.

### Session Forking & Fork Hierarchy

Sessions can be forked at a specific user message, mirroring pi's `/fork` (default `position: 'before'`), and the sidebar renders the resulting parent/child hierarchy.

- **Fork hierarchy (sidebar tree):** pi stamps a forked session's header with `parentSession` (the source `.jsonl` path). `SessionManager.listAll()` already returns this as `parentSessionPath`; the `/sessions` endpoint (`session-pool.ts` `buildFolders`/`buildDiskSessionInfo`) now threads it into each `FolderSessionInfo` (normalized so a child's `parentSessionPath` matches a sibling's `path`). The web (`SessionBrowser.svelte` `buildForkTree`) nests each session under its parent WITHIN a folder (indent + ↳ marker), depth-first, cycle-safe; cross-folder parents surface as roots. This is display-only and mirrors pi's own session selector.
- **Fork at a user message (`/fork` parity):** every user message in the transcript carries its source tree `entryId` (added to `HistoryMessage` on the `user` branch of `mapEntriesToHistory`, and to the client `ChatMessage`). `ChatMessageList.svelte` shows a "Fork" action on each user bubble. Clicking it runs the WS exchange `session_fork { sessionId, entryId }` -> `session_forked { sessionFile, cwd, prefillText }`. The server (`SessionPool.forkSession`) opens the SOURCE, validates the entry is a `user` message, and creates a new branched file via the SDK's `createBranchedSession(parentIdOfThatEntry)` (position 'before' => the branch ends just before the chosen message; a null parent means fork-before-first, handled by `SessionManager.create(...).newSession({ parentSession })`). The new file records `parentSession` = source (feeding the hierarchy above). `forkSession` does NOT build a live agent or attach a client: the web loads the returned file through the normal `session_load` fast-first path, then pre-fills the composer with `prefillText` (the forked-at message, to edit and resend) via the `composerPrefill` store consumed by `ChatInput.svelte`.

### File Download / Attachments

The reverse of the upload path: files the agent produces (a generated PDF, an export, a note in the work folder) can be pulled down to a phone/browser and shown as tappable chips/links.

- **Endpoint** (`server/src/index.ts`): `GET /session/download?sessionId=..&path=..` streams the file with `Content-Disposition: attachment`. Behind the same token gate as the other `/session/*` routes.
- **Security (deny-by-default):** `resolveSafeDownloadPath()` realpath-resolves the requested path BEFORE a containment check, so neither `..` traversal nor an in-tree symlink can escape. Allowed roots (`resolveDownloadRoots()`) are always the session `cwd` + the resolved upload dir, plus `config.downloads.roots`. Out-of-root returns `404` (existence not leaked); oversized returns `413` (`config.downloads.maxBytes`, default 100 MiB); `config.downloads.enabled: false` disables the feature (`403`).
- **The download button is driven by the tool CALL, not by any side channel.** The web UI (`ChatMessageList.svelte` + `parseToolMessage()`, using `extractDownloadablePath()` from `web/src/lib/core/media-kind.ts`) inspects each tool call and, for a small set of file-oriented tools, renders a ⬇️ download link in the tool-card header (a sibling anchor beside Expand/Collapse, never nested in the button) whose href is built by `downloadFileUrl()` in `web/src/lib/wherever.ts` (carrying sessionId + token). This works for BOTH CLI-bridge and pure server-side (web-frontend) sessions, because both already stream `tool_start`/`tool_end` to every client. No `file_attachment` message, no `attachment` chat role, no bridge marker.
  - `attach_file`: the intended, agent-driven download. The agent calls it to offer a specific file ("give me the gpx", or right after producing a PDF).
  - `read`: opportunistic. Its card already carries the exact path the agent read, so a button is offered there too.
  - `write` / `edit` are NOT offered (a download of a file the agent just wrote is noise), and `ls`/`grep`/`find` are excluded (their path arg is a directory/search scope). The download/preview tool set is exactly `read` + `attach_file`.
- **Inline media preview (image; audio/video planned).** For a card that carries a downloadable path whose extension is a media type (`mediaKind()` in `web/src/lib/core/media-kind.ts` classifies `image`/`audio`/`video` by extension, case-insensitive — no client MIME sniffing, the path is already server-validated), an inline preview is rendered from the SAME `downloadFileUrl(path)` (NOT from embedded bytes), OUTSIDE the collapsible section so it survives collapse, tap-to-open (link to the URL) and lazy-loaded. Images preview as `<img>`; the download chip STAYS (the preview is additive). De-dup: a `read` on an image can also carry model-facing image blocks (`msg.images` as `data:` thumbnails — an untouched, separate path); when `msg.images` is present the download-URL `<img>` is suppressed, so a card shows exactly one preview.
- **`attach_file` is a SELF-CONTAINED tool, registered in TWO places** so it exists in every session type:
  - **Server-side sessions** (web frontend, no terminal): `server/src/attach-file-tool.ts` (`createAttachFileTool(cwd)`) is passed as a `customTool` into both `createAgentSession()` calls in `session-pool.ts`. The tool runs inside the server's own agent.
  - **CLI-bridge sessions** (terminal pi): the same tool is registered by the `@wherever-dev/pi` extension (`extension/src/index.ts`), the extension you already load (nothing extra to install).
  - In both, `execute` only validates the path and returns a normal tool result (`details: { path, filename, size }`). It does NOT read the file bytes and does NOT touch the bridge. The earlier bridge-marker design (a `file_attachment` cli_event relayed to a `file_attachment` ServerMessage) was REMOVED, because it could not work in a web-frontend session (no bridge). Its prompt tells the agent that a bare file path in a reply is never enough for a remote user; it must call `attach_file`.
- **(Removed) prose path auto-linkify:** an earlier approach linkified file-path-looking tokens in assistant prose. Dropped because it was fuzzy (guessed paths, could 404 on out-of-root/non-existent paths).

### Event Flow

1. Client connects via WebSocket
2. Server broadcasts pi lifecycle events:
   - `agent_start` / `agent_end`
   - `message_update` (streaming text)
   - `message_end`
   - `tool_start` / `tool_end`
3. Client sends messages via WebSocket or HTTP
4. Server forwards to pi via `pi.sendUserMessage()`

### Message routing authority (the client-stamped sessionId is authoritative)

Every WS `message` (and `abort`) carries the `sessionId` of the session the client is actually viewing (`{ type: 'message'; message; sessionId }`). The server treats that stamp as AUTHORITATIVE: in `server/src/index.ts` the `message`/`abort` handlers resolve `msg.sessionId` through the pool and verify it resolves to the SAME `TrackedSession` this connection is attached to (`client.sessionId`). On a mismatch the message is REFUSED with a `session_error` (the client surfaces it as a recoverable, retryable failure via its delivery watchdog + Retry) instead of being delivered to whatever `client.sessionId` currently points at. This closes a switch/reconnect/resync race: `client.sessionId` is per-connection and is only (re)attached when a `session_load` completes (for a cold load, seconds later inside the async agent-build block; a reconnected socket starts with `client.sessionId = null`), so it could be stale relative to the session the client had already painted and targeted, silently misrouting a message into another session's agent. Never route a `message`/`abort` by `client.sessionId` alone without validating it against the client-stamped `msg.sessionId`.

## Current Status

✅ **Completed:**

- Core extension with HTTP/WebSocket server
- Reference client implementation
- Complete API documentation
- Package configuration
- Git repository initialized
- Initial commit made

⏳ **Next Steps:**

1. Install dependencies and test locally
2. Push to GitHub
3. ✅ Build web frontend (mobile-friendly)
4. ✅ Build marketing site (GitHub Pages)
5. Add more example clients
6. Consider publishing to npm as pi package

## Usage Commands

```bash
# Development
cd /home/wighawag/dev/github/wighawag/wherever
pnpm install
pnpm run build

# Test the extension
pi --extension ./dist/index.js --remote-port 31415 --remote-token test123

# Test the client
pnpm run client -- --url ws://localhost:31415 --token test123

# Push to GitHub
git remote add origin git@github.com:wighawag/wherever.git
git push -u origin main
```

## Security Considerations

⚠️ **Important:**

- Always use `--remote-token` for remote access
- Default binding is localhost only (`127.0.0.1`)
- For remote access, use SSH tunneling:
  ```bash
  ssh -L 31415:localhost:31415 user@remote-machine
  ```
- If binding to `0.0.0.0`, ensure strong authentication
- Consider adding rate limiting for production use

## Mobile Usage (Original Motivation)

The extension was created to enable mobile control of pi without relying on SSH clients. Options:

1. **Simple Web Interface** - Build a mobile-friendly web UI (not yet implemented)
2. **WebSocket Apps** - Use existing mobile WebSocket clients
3. **SSH Tunnel + Local Connect** - Tunnel to mobile, connect via localhost

## File Structure

```
wherever/
├── src/
│   ├── index.ts          # Main extension (server)
│   └── client.ts         # Reference client
├── docs/
│   └── USAGE.md          # Complete API docs
├── web/                  # SvelteKit dashboard app (mobile-friendly)
├── site/                 # Standalone marketing/info website (GitHub Pages)
├── vscode/               # VS Code Companion extension (Sidebar Chat GUI)
├── client/               # Isomorphic TS Client module
├── server/               # Multi-session standalone server
├── .github/
│   └── workflows/
│       └── deploy-gh-pages.yml  # CI/CD for marketing site
├── package.json          # Dependencies + pi config
├── tsconfig.json         # TypeScript config
├── README.md             # Quick start
├── CONTEXT.md            # This file
├── LICENSE               # AGPL-3.0
└── .gitignore
```

## Key Design Decisions

1. **WebSocket-first** - Real-time streaming is essential for agent interaction
2. **HTTP fallback** - Simple REST API for programmatic access
3. **Optional auth** - Token-based, easy to disable for local dev
4. **Event broadcasting** - All clients receive same events (multi-client support)
5. **Message queuing** - Messages queued if no client connected (up to 100)
6. **Separate web UI** - Dashboard (`web/`) and marketing site (`site/`) are independent SvelteKit apps
7. **GitHub Pages** - Marketing site deployed via GitHub Actions to `github.com/wighawag/wherever`

## Agent Guidelines

⚠️ **Important for AI Agents:**
Please review **`AGENTS.md`** in the root of the project before completing any work. It contains essential guidelines, including the requirement to **always create a changeset** with a good description when done.

## Known Limitations

- No rate limiting (add for production use)
- No connection persistence/reconnection logic (client responsibility)
- Single active WebSocket for broadcasting (all clients get same stream)
- No extension UI dialog forwarding (confirmations happen on server side)

## Future Enhancements

Potential additions:

- [ ] Multiple WebSocket rooms/sessions
- [ ] Rate limiting middleware
- [ ] WebSocket reconnection logic
- [ ] Extension UI dialog forwarding to remote clients
- [ ] Custom tool registration via API
- [x] File transfer capabilities (upload via `/session/upload`; download via `/session/download`, surfaced as a download button + inline image preview on `read` tool cards plus the `attach_file` tool for explicit/"give me the X" deliverables)

## Related Pi Documentation

- [Pi Extensions](https://pi.dev/docs/extensions.md) - Extension API reference
- [Pi RPC Mode](https://pi.dev/docs/rpc.md) - Alternative integration method
- [Pi SDK](https://pi.dev/docs/sdk.md) - Programmatic usage

## Contact & Contributing

- Repository: `github.com/wighawag/wherever`
- License: AGPL-3.0-only
- Contributions welcome!

## Conventions

Standing per-change rules agents must follow in this repo.

- **Always create a changeset when done** (`pnpm changeset`, or a hand-written
  `.changeset/*.md`). See `AGENTS.md` §1 for the full rule. Package-mapping:
  - **web** and **server** changes → `"wherever-dev": <bump>`.
  - **extension** changes (`extension/`) → `"@wherever-dev/pi": <bump>`.
  - Never use `"@wherever-dev/web"` — the `web` package is private and its built
    artifacts ship inside `wherever-dev`.
- **Never stage/commit** unless explicitly asked; leave changes unstaged.
- **Never revert / do destructive git ops** without explicit confirmation.
- Enforcement, if wanted, belongs in the `dorfl.json` `verify` gate (e.g.
  `changeset status --since=main`) — not injected automatically.

## The work/ contract

This repo is onboarded onto the file-based **`work/` contract** (defined by the
docs in `work/protocol/`, synced by the `setup` skill; `dorfl.json` carries the
`verify` gate and `harness`). Layout — status is the FOLDER an item lives in,
never a frontmatter field; the folder is the index (no hand-maintained lists):

- `work/notes/{observations,ideas,findings}/` — capture buckets. `observations`
  = spotted/unverified; `ideas` = proposed; `findings` = verified **external**
  ground-truth, each with a `source:` (our own architecture goes in this
  `CONTEXT.md` / `docs/`, never in `findings/`).
- `work/tasks/{backlog,ready,…}/` — the build board (`backlog` = staging,
  `ready` = the pool).
- `work/specs/{proposed,ready,…}/` — the spec lifecycle (`proposed` = staging,
  `ready` = the pool). The three specs in `specs/ready/` were migrated here from
  the old `work/briefs/ready/`.
- `work/questions/` — the "what needs me?" queue. `work/protocol/` — the synced
  contract reference docs (protocol-owned; re-synced, never hand-edited).

Architectural rationale lives in `docs/adr/` (decisions); product framing in
`work/specs/`.

---

**Note:** This document is meant to provide full context when moving to a new conversation/session. All essential project information should be here.
