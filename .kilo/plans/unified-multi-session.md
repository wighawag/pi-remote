# Multi-Session Standalone Server — Unified Plan

## Goal

Build a **standalone server** that manages multiple pi sessions concurrently using the in-process SDK, paired with a web frontend featuring a session browser grouped by folder. Sessions are:
- **Created on demand** when a client requests a session
- **Auto-saved** to disk as they run (same session files as the CLI)
- **Agent process destroyed** when no clients are connected AND the agent is idle (waiting for user input) for 5 minutes. The session file (conversation history) on disk is always preserved and can be reloaded later.

This replaces the extension-based single-session architecture with:
- Multiple sessions running concurrently, one per folder/project
- Reusing existing session files created from the pi CLI
- True multi-client collaboration with per-folder isolation
- Automatic resource cleanup
- A session browser in the sidebar grouped by folder

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              Pi Remote Server (Standalone)            │
│                                                       │
│  ┌─────────────┐  ┌───────────────────────────────┐  │
│  │ HTTP/WS API │  │     Session Pool               │  │
│  │ (Gateway)   │  │                                │  │
│  └──────┬──────┘  │  ┌──────────┐ ┌──────────┐   │  │
│         │         │  │ Session A│ │ Session B│   │  │
│         │         │  │ /proj-a  │ │ /proj-b  │   │  │
│         ▼         │  └────┬─────┘ └────┬─────┘   │  │
│    Route by       │       │            │          │  │
│    session ID     │  ┌────▼─────┐ ┌────▼─────┐   │  │
│                   │  │AgentSess │ │AgentSess │   │  │
│                   │  │  (SDK)   │ │  (SDK)   │   │  │
│                   │  └──────────┘ └──────────┘   │  │
│                   └───────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

Each session wraps an `AgentSession` created via `createAgentSession()` from the SDK, with `SessionManager.open()` or `SessionManager.create()` for file persistence.

## Conflict Resolution

**Collaborative mode:** Two clients on the **same session** can both send messages and both see responses. Pi processes messages sequentially, so concurrent messages get queued naturally. No conflict.

**Conflict (different sessions, same folder):** A conflict only occurs when clients try to operate on **different sessions** in the same folder. A dialog appears with two options:
- **Take Over** — interrupt the other client and switch
- **Read Only** — observe the other client's session live (receive events) but cannot send messages. The client's chat input is disabled with a "Read-only: another session is active in this folder" banner.

## Changes

### 1. New Server Module

**New directory:** `server/`

```
server/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts           # Entry point, HTTP/WS server
    ├── session-pool.ts    # Session lifecycle management
    ├── session-types.ts   # Types for session state tracking
    └── protocol.ts        # WS message types and routing
```

**`server/package.json`:**
```json
{
  "name": "pi-remote-server",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "^0.75.3",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

### 2. Session Types

**File:** `server/src/session-types.ts`

```ts
export interface SessionInfo {
  sessionId: string;
  sessionFile: string;
  cwd: string;
  model?: string;
  clientCount: number;
  isIdle: boolean;
  createdAt: number;
  lastActivity: number;
}

export interface FolderWithSessions {
  path: string;
  name: string;
  sessions: Array<{
    path: string;
    id: string;
    name?: string;
    created: string;
    modified: string;
    messageCount: number;
    firstMessage: string;
    isActive: boolean;
    clientCount: number;
  }>;
}

export interface SessionsResponse {
  folders: FolderWithSessions[];
  activeSessions: SessionInfo[];
}

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}
```

### 3. Session Pool — Lifecycle Management

**File:** `server/src/session-pool.ts`

Manages creation, tracking, and destruction of active sessions.

```ts
interface TrackedSession {
  sessionId: string;
  sessionFile: string;
  cwd: string;
  model: string;
  agentSession: AgentSession;
  clients: Set<string>;
  isIdle: boolean;
  idleTimer: NodeJS.Timeout | null;
  createdAt: number;
  lastActivity: number;
}
```

**Key operations:**

- `getSession(sessionId)` — return existing session or null
- `getSessionHistory(sessionId)` — reconstruct chat messages from session manager entries, return `HistoryMessage[]`
- `loadSession(sessionFile, cwd, model?)` — open existing session file via `SessionManager.open()`, resolve model (client override → session header → default), create `AgentSession`, return tracked session
- `createNewSession(cwd, model?)` — create new session via `SessionManager.create(cwd)`, resolve model (client override → default), create `AgentSession`, return tracked session
- `addClient(sessionId, clientId)` — register client with session, send message history
- `removeClient(sessionId, clientId)` — unregister client, schedule idle check
- `scheduleIdleCheck(sessionId)` — start 5-minute timer; if agent is idle AND no clients remain, dispose session
- `cancelIdleCheck(sessionId)` — cancel pending idle timer
- `destroySession(sessionId)` — call `agentSession.dispose()`, clean up timers
- `listSessions()` — return metadata for all tracked sessions (combines active sessions + disk sessions from `SessionManager.listAll()`)
- `listAvailableModels()` — return available models from model registry for the web UI
- `disposeAll()` — clean up all sessions on shutdown

**Idle detection:**
- Track `isIdle` via agent events: `agent_start` → not idle, `agent_end` → idle
- On `removeClient`: if `clients.size === 0` AND `isIdle === true`, start 5-minute timer
- On timer expiry: destroy session
- On any new activity (client connects, message sent): cancel timer

**Shared resources (created once at server startup):**
```ts
const authStorage = createAuthStorage();
const modelRegistry = createModelRegistry();
const resourceLoader = createResourceLoader();
```

**Model selection:**
When creating or loading a session, the model is determined by:
1. **Client override** — if the client sends a `model` field with `session_load` or `session_new`, use that model (validated against available models)
2. **Session file** — read the model from the session file's header (via `sessionManager.getHeader()`)
3. **Pi default** — fall back to the default model from pi's config/settings

**Message history reconstruction:**
`getSessionHistory(sessionId)` iterates `sessionManager.getEntries()` and filters for `SessionMessageEntry` types. Each entry is mapped to `HistoryMessage`:
- User messages: `role: 'user'`, content from message text
- Assistant messages: `role: 'assistant'`, content from assistant response text
- Compaction entries: skipped (they're metadata, not chat messages)
- Tool entries: included as system-style messages for context

**Error handling:**
- If `createAgentSession()` fails (model unavailable, auth error): send `session_error` event to requesting client with error message
- If `SessionManager.open()` fails (corrupted file, missing file): send `session_error` with reason
- If session creation fails during `session_new`: send `session_error`, don't add to pool
- All errors logged server-side with session context for debugging

### 4. Protocol — WS Message Types

**File:** `server/src/protocol.ts`

All WS messages include `sessionId` for routing. Server routes events to the correct client(s).

**Client → Server messages:**
```ts
type ClientMessage =
  | { type: 'connect' }
  | { type: 'message'; message: string; sessionId: string }
  | { type: 'abort'; sessionId: string }
  | { type: 'ping' }
  | { type: 'session_load'; sessionFile: string; cwd?: string; model?: string }
  | { type: 'session_new'; cwd: string; model?: string }
  | { type: 'session_leave'; sessionId: string }
  | { type: 'session_resolve_conflict'; action: 'take_over' | 'read_only'; sessionId: string };
```

**Server → Client messages:**
```ts
type ServerMessage =
  | { type: 'connected'; clientId: string }
  | { type: 'agent_start'; sessionId: string }
  | { type: 'message_update'; sessionId: string; delta: string }
  | { type: 'message_end'; sessionId: string; content: string }
  | { type: 'agent_end'; sessionId: string }
  | { type: 'tool_start'; sessionId: string; toolName: string; args: any }
  | { type: 'tool_end'; sessionId: string; toolName: string; isError: boolean }
  | { type: 'session_created'; sessionId: string; sessionFile: string; cwd: string; model: string }
  | { type: 'session_destroyed'; sessionId: string; reason: string }
  | { type: 'session_error'; sessionId?: string; error: string; detail?: string }
  | { type: 'session_conflict'; sessionId: string; conflictingSession: string; conflictingCwd: string }
  | { type: 'session_interrupted'; sessionId: string; reason: string }
  | { type: 'message_history'; sessionId: string; messages: HistoryMessage[] }
  | { type: 'pong'; timestamp: number };
```

### 5. HTTP/WS Server

**File:** `server/src/index.ts`

Entry point. Creates HTTP server + WebSocket server. Routes requests to session pool.

**CLI flags / env vars:**
```
--port, PI_REMOTE_PORT        (default: 8765)
--host, PI_REMOTE_HOST        (default: 127.0.0.1)
--token, PI_REMOTE_TOKEN      (optional auth token)
--idle-timeout, PI_IDLE_TIMEOUT (default: 300000 = 5 minutes)
```

**HTTP endpoints:**
```
GET  /health                  — Health check (no auth)
GET  /sessions                — List all sessions grouped by folder
GET  /models                  — List available models for selection
POST /session/destroy         — Force destroy a session { sessionId }
POST /session/new             — Create new session { cwd, model? }
```

**WebSocket:** `ws://host:port/ws?token=XXX`

On WS connect:
1. Generate `clientId`
2. Send `connected` event with `clientId`
3. Client sends `session_load` or `session_new` to join a session
4. All subsequent events are routed by `sessionId`

**Conflict detection (per-folder):**

The client sends `session_load` with `sessionFile` and `cwd`. The server resolves the session ID from the file path, then checks:
```ts
function detectConflict(targetSessionId: string, targetCwd: string) {
  // Same session already loaded = collaborate (no conflict)
  if (sessions.has(targetSessionId)) return { conflict: false };

  // Target not loaded yet — check for cwd conflict with any active session
  for (const s of sessions.values()) {
    if (s.cwd === targetCwd) {
      return { conflict: true, otherSessionId: s.sessionId, otherCwd: s.cwd };
    }
  }
  return { conflict: false };
}
```
If the target session's cwd conflicts with an active session, the server sends `session_conflict` to the requesting client.

**Message history on join:**
When a client sends `session_load`, the server sends a `message_history` event containing the session's reconstructed chat messages before subscribing to live events.

### 6. Web — Session Store & API Layer

**New file:** `web/src/lib/session-store.ts`

```ts
interface SessionInfo {
  sessionId: string;
  sessionFile: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  isActive: boolean;
  clientCount: number;
}

interface FolderWithSessions {
  path: string;
  name: string;
  sessions: SessionInfo[];
}

interface ConflictInfo {
  targetSessionId: string;
  conflictingSessionId: string;
  conflictingCwd: string;
}

interface ModelInfo {
  provider: string;
  modelId: string;
  label: string;           // Display name, e.g. "Anthropic: Claude Opus 4.5"
  isDefault?: boolean;
}
```

- `sessionFolders` writable store: `{ folders: FolderWithSessions[], activeSessions: string[], currentSession: string | null, loading: boolean }`
- `availableModels` writable store: `{ models: ModelInfo[] }`
- `fetchSessions()` — calls `GET /sessions`, groups by folder, updates store
- `fetchModels()` — calls `GET /models`, updates store
- `switchSession(sessionPath, sessionId, cwd, model?)` — sends `session_load` WS message
- `newSessionInCwd(cwd, model?)` — sends `session_new` WS message
- `leaveSession(sessionId)` — sends `session_leave` WS message
- `resolveConflict(action, sessionId)` — sends `session_resolve_conflict` WS message
- Helper to derive HTTP base URL from stored WS config

**File:** `web/src/lib/pi-remote.ts`

- `connect()` establishes WS connection but does NOT auto-join a session
- Add `joinSession(sessionFile, cwd, model?)` — sends `session_load` message with optional model
- Add `createSession(cwd, model?)` — sends `session_new` message with optional model
- Add `leaveSession(sessionId)` — sends `session_leave` message
- All outgoing WS messages include `sessionId` field
- State tracks: `activeSessionId`, `activeSessionFile`, `activeCwd`, `activeModel`
- Add `conflict` field: `ConflictInfo | null` — populated on `session_conflict` event
- Add `isInterrupted` field — set on `session_interrupted` event
- Add `sessionError` field: `string | null` — set on `session_error` event
- Handle `message_history` — populate chat messages store
- Handle `session_created`, `session_destroyed`, `session_error` events
- On `session_destroyed` for current session: clear chat, show "Session ended"
- On `session_error`: show error toast, don't change session state

### 7. Web — SessionBrowser Component

**New file:** `web/src/lib/components/SessionBrowser.svelte`

Svelte 5 component with:
- Folder groups rendered as collapsible sections
- Each folder shows:
  - Folder name (derived from last path segment) + full path on hover
  - "New Session Here" button at top of group (opens a small model picker dropdown)
  - List of sessions with: session name (or truncated first message), modified date, message count
  - Click on session to load it
  - Green indicator dot for active sessions (currently loaded on server)
  - Client count badge on active sessions
- Loading state spinner
- Empty state when no sessions exist
- "Refresh" button to re-fetch sessions
- Dark theme styling matching existing UI (gray-800/900 palette)

**Model picker (small inline dropdown):**
- Appears when clicking "New Session Here"
- Shows available models from `availableModels` store
- Default model pre-selected (from pi config)
- "Use default" option to skip explicit model selection

### 8. Web — Conflict Dialog Component

**New file:** `web/src/lib/components/SessionConflictDialog.svelte`

Modal dialog that appears when `$piState.conflict` is non-null. Shows:
- Message: "Another client is active on session {sessionName}. What would you like to do?"
- **Take Over** button (red/danger) — interrupts the other client and switches
- **Read Only** button — stay on current session, can't send messages for target folder

### 9. Web — Interruption Notification

**Inline in `+page.svelte`** (toast/banner component):
- Triggered when `$piState.isInterrupted` is true
- "Your session was interrupted — another client took over."
- Auto-dismisses after 5 seconds

### 10. Web — Integrate into Sidebar & Main Page

**File:** `web/src/routes/+page.svelte`

- Import `SessionBrowser` and `SessionConflictDialog` components
- Import `fetchSessions` from session store
- Add `SessionBrowser` below the connection status section in the sidebar
- Add `SessionConflictDialog` as a modal overlay on the page
- Call `fetchSessions()` when connection is established (derive from `$piState.connected`)
- Also refresh sessions list after `agent_end` event (new session may have been created)
- Add refresh button in sidebar actions
- When a session switch happens, clear the chat messages locally
- Show interruption notification when `$piState.isInterrupted` is true
- Disable chat input and show banner when interrupted
- After connecting, sidebar shows the session browser (landing page shows folder list)
- Top bar shows active session info (session name, cwd, client count)

### 11. Workspace Configuration

**File:** `pnpm-workspace.yaml` — add `server/` to workspaces:
```yaml
packages:
  - "extension"
  - "web"
  - "server"
```

**File:** `package.json` (root) — add server dev script following existing pattern:
```json
"server:dev": "ldenv pnpm --filter ./server dev",
"server:build": "ldenv pnpm --filter ./server build",
```

**File:** `server/tsconfig.json` — mirror extension's tsconfig (NodeNext modules, ESNext target, strict mode)

**File:** `zellij.kdl` — add a pane for the server process in the development layout

### 12. Session File Compatibility

Sessions created by the server use the same file format as the pi CLI:
- `SessionManager.create(cwd)` creates files in `~/.pi/agent/sessions/`
- `SessionManager.open(path)` loads existing CLI sessions
- Sessions auto-save via the SDK's built-in persistence
- A session created by the server can later be opened from the CLI and vice versa

## Implementation Order

1. Create `server/` module structure, package.json, tsconfig
2. Implement `server/src/session-types.ts` — types
3. Implement `server/src/session-pool.ts` — session lifecycle, idle detection, shared resources
4. Implement `server/src/protocol.ts` — WS message types and routing
5. Implement `server/src/index.ts` — HTTP/WS server, endpoints, session pool integration
6. Create `web/src/lib/session-store.ts` — session store, types, API functions
7. Update `web/src/lib/pi-remote.ts` — session-scoped messages, join/leave, conflict/interruption handling
8. Create `web/src/lib/components/SessionBrowser.svelte`
9. Create `web/src/lib/components/SessionConflictDialog.svelte`
10. Update `web/src/routes/+page.svelte` — integrate sidebar, modal, notifications
11. Update workspace config (pnpm-workspace.yaml, root package.json)
12. Test end-to-end

## Notes

- The server runs as a standalone process: `node server/dist/index.js --port 8765`
- The extension (`extension/`) is still available for CLI workflow but is now **optional** — the server is the primary way to access pi remotely
- Shared resources (auth, model registry) are created once at startup to minimize overhead
- Each session's `AgentSession` is fully independent with its own agent loop, message history, and streaming state
- The 5-minute idle timeout is configurable via `--idle-timeout` flag or `PI_IDLE_TIMEOUT` env var
- Session destruction is graceful: the session file is saved before disposal, so history is preserved
- **Graceful shutdown:** On SIGTERM/SIGINT, save all sessions and dispose them cleanly
- `SessionManager.listAll()` may take time on first run (indexes all sessions). Consider caching the response on the server side
- **Initial connection flow:** After WS connect, the client fetches sessions list and models list in parallel, then shows the session browser. No session is auto-joined — the user picks one from the sidebar.
- **Model selection priority:** Client override → session file header → pi default config
- **Read-only mode:** When a client chooses "Read Only" during conflict resolution, they receive live events from the conflicting session but their chat input is disabled with a banner explaining why
