# Multi-Session Standalone Server

**Prerequisite:** Plan `1779291191405-calm-squid.md` (Session Browser) is already implemented.

## Goal

Replace the extension-based single-session architecture with a **standalone server** that manages multiple pi sessions concurrently using the in-process SDK. Sessions are:

- **Created on demand** when a client requests a session
- **Auto-saved** to disk as they run (same session files as the CLI)
- **Destroyed** when no clients are connected AND the agent is idle (waiting for user input) for 5 minutes

This enables:

- Multiple sessions running concurrently, one per folder/project
- Reusing existing session files created from the pi CLI
- True multi-client collaboration with per-folder isolation
- Automatic resource cleanup

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              Pi Remote Server (Standalone)            │
│                                                       │
│  ┌─────────────┐  ┌───────────────────────────────┐  │
│  │ HTTP/WS API │  │     Session Manager            │  │
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

Each session wraps an `AgentSession` created via `createAgentSession()` from the SDK, with a `SessionManager.open()` or `SessionManager.create()` for file persistence.

## Changes

### 1. New Server Module

**New directory:** `server/`

```
server/
├── package.json          # Dependencies: @earendil-works/pi-coding-agent, ws
├── tsconfig.json
└── src/
    ├── index.ts           # Entry point, creates HTTP/WS server
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

### 2. Session Pool — Lifecycle Management

**File:** `server/src/session-pool.ts`

Manages the creation, tracking, and destruction of active sessions.

```ts
interface TrackedSession {
  sessionId: string;
  sessionFile: string;
  cwd: string;
  agentSession: AgentSession;
  clients: Set<string>; // Connected client IDs
  isIdle: boolean; // Agent waiting for user input
  idleTimer: NodeJS.Timeout | null;
  createdAt: number;
  lastActivity: number;
}
```

**Key operations:**

- `getSession(sessionId)` — return existing session or null
- `getSessionHistory(sessionId)` — reconstruct chat messages from session manager entries, return `HistoryMessage[]`
- `loadSession(sessionFile, cwd)` — open existing session file via `SessionManager.open()`, create `AgentSession`, return tracked session
- `createNewSession(cwd)` — create new session via `SessionManager.create(cwd)`, create `AgentSession`, return tracked session
- `addClient(sessionId, clientId)` — register client with session, send message history
- `removeClient(sessionId, clientId)` — unregister client, schedule idle check
- `scheduleIdleCheck(sessionId)` — start 5-minute timer; if agent is idle AND no clients remain, dispose session
- `cancelIdleCheck(sessionId)` — cancel pending idle timer
- `destroySession(sessionId)` — call `agentSession.dispose()`, clean up timers
- `listSessions()` — return metadata for all tracked sessions
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

These are shared across all sessions to avoid redundant auth/model setup.

### 3. Session Types

**File:** `server/src/session-types.ts`

```ts
export interface SessionInfo {
  sessionId: string;
  sessionFile: string;
  cwd: string;
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
    isActive: boolean; // Currently loaded in server
    clientCount: number;
  }>;
}

export interface SessionsResponse {
  folders: FolderWithSessions[];
  activeSessions: SessionInfo[];
}
```

### 4. Protocol — WS Message Types

**File:** `server/src/protocol.ts`

All WS messages include `sessionId` for routing. Server routes events to the correct client(s).

**Client → Server messages:**

```ts
type ClientMessage =
  | { type: "connect" } // Initial handshake
  | { type: "message"; message: string; sessionId: string }
  | { type: "abort"; sessionId: string }
  | { type: "ping" }
  | { type: "session_load"; sessionFile: string; cwd?: string }
  | { type: "session_new"; cwd: string }
  | { type: "session_leave"; sessionId: string }
  | {
      type: "session_resolve_conflict";
      action: "take_over" | "read_only";
      sessionId: string;
    };
```

**Server → Client messages:**

```ts
type ServerMessage =
  | {
      type: "connected";
      clientId: string;
      sessionId: string;
      sessionFile: string;
      cwd: string;
    }
  | { type: "agent_start"; sessionId: string }
  | { type: "message_update"; sessionId: string; delta: string }
  | { type: "message_end"; sessionId: string; content: string }
  | { type: "agent_end"; sessionId: string }
  | { type: "tool_start"; sessionId: string; toolName: string; args: any }
  | { type: "tool_end"; sessionId: string; toolName: string; isError: boolean }
  | {
      type: "session_created";
      sessionId: string;
      sessionFile: string;
      cwd: string;
    }
  | { type: "session_destroyed"; sessionId: string; reason: string }
  | { type: "session_conflict"; sessionId: string; conflictingSession: string }
  | { type: "session_interrupted"; sessionId: string; reason: string }
  | { type: "session_changed"; sessionId: string; cwd: string }
  | { type: "message_history"; sessionId: string; messages: HistoryMessage[] }
  | { type: "pong"; timestamp: number };

interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}
```

### 5. HTTP/WS Server

**File:** `server/src/index.ts`

Entry point. Creates HTTP server + WebSocket server. Routes requests to session pool.

**CLI flags / env vars:**

```
--port, PI_REMOTE_PORT        (default: 31415)
--host, PI_REMOTE_HOST        (default: 127.0.0.1)
--token, PI_REMOTE_TOKEN      (optional auth token)
--session-dir, PI_SESSION_DIR (default: ~/.pi/agent/sessions)
--idle-timeout, PI_IDLE_TIMEOUT (default: 300000 = 5 minutes)
```

**HTTP endpoints:**

```
GET  /health                  — Health check (no auth)
GET  /sessions                — List all sessions grouped by folder
GET  /session/:id/messages    — Get message history for a session
POST /session/destroy         — Force destroy a session { sessionId }
POST /session/new             — Create new session in cwd { cwd }
```

**Session history on join:**
When a client joins a session, the server should provide the session's message history. Two approaches:

1. **WS event on join:** Server sends a batch of `message_history` events containing past messages when `session_load` is processed
2. **HTTP fetch:** Client fetches `/session/:id/messages` before joining

Approach 1 is cleaner (single protocol). The server can use `agentSession.getSessionStats()` or iterate the session manager's entries to reconstruct messages.

**WebSocket:**

```
ws://host:port/ws?token=XXX   — Main WebSocket connection
```

On WS connect:

1. Generate `clientId`
2. Send `connected` event
3. Client sends `session_load` or `session_new` to join a session
4. All subsequent events are routed by `sessionId`

### 6. Web Client Updates

The web frontend already has the session browser from plan 1. Updates needed:

**File:** `web/src/lib/pi-remote.ts`

- Change `connect()` to establish WS connection but NOT auto-join a session
- Add `joinSession(sessionFile, cwd)` — sends `session_load` message
- Add `createSession(cwd)` — sends `session_new` message
- Add `leaveSession(sessionId)` — sends `session_leave` message
- WS messages now include `sessionId` field
- State tracks active session: `activeSessionId`, `activeSessionFile`, `activeCwd`
- Handle `session_created`, `session_destroyed` events
- Handle `message_history` event on session join — populate chat with past messages
- On `session_destroyed`: clear chat, show "Session ended" message

**File:** `web/src/lib/session-store.ts`

- `fetchSessions()` now calls the server's `/sessions` endpoint
- Response includes `activeSessions` with `isActive` and `clientCount`
- Sessions that are `isActive: true` get a visual indicator
- "New Session Here" button calls `createSession(cwd)`
- Click on session calls `joinSession(path, cwd)`
- Show client count badge on active sessions

**File:** `web/src/routes/+page.svelte`

- After connecting, sidebar shows session browser
- Clicking a session joins it (clears chat, loads session context)
- If session is not active on server, server creates it on demand
- Show active session info in top bar
- Handle session destruction gracefully

### 7. Conflict Resolution (Multi-Session Mode)

Same conflict dialog from plan 1, but now with **per-folder** scoping:

- Client A is on session in `/proj-a`
- Client B tries to load session in `/proj-a` → conflict (same cwd, different session)
- Client B tries to load session in `/proj-b` → no conflict, server creates new session
- Client B tries to load **same** session as Client A → no conflict, both collaborate

The `session-pool.ts` tracks which sessions are active. Conflict detection:

```ts
function detectConflict(
  requestingClientId: string,
  targetSessionId: string,
  targetCwd: string,
) {
  // Same session = collaborate (no conflict)
  const existing = sessions.get(targetSessionId);
  if (existing) return { conflict: false };

  // Different session, same cwd = conflict
  for (const s of sessions.values()) {
    if (s.cwd === targetCwd && s.sessionId !== targetSessionId) {
      return { conflict: true, otherSessionId: s.sessionId, otherCwd: s.cwd };
    }
  }
  return { conflict: false };
}
```

### 8. Session File Compatibility

Sessions created by the server use the same file format as the pi CLI:

- `SessionManager.create(cwd)` creates files in `~/.pi/agent/sessions/`
- `SessionManager.open(path)` loads existing CLI sessions
- Sessions auto-save via the SDK's built-in persistence
- A session created by the server can later be opened from the CLI and vice versa

## Implementation Order

1. Create `server/` module structure, package.json, tsconfig
2. Implement `session-types.ts` — types
3. Implement `session-pool.ts` — session lifecycle, idle detection, shared resources
4. Implement `protocol.ts` — WS message types and routing logic
5. Implement `server/src/index.ts` — HTTP/WS server, endpoints, session pool integration
6. Update `web/src/lib/pi-remote.ts` — session-scoped messages, join/leave
7. Update `web/src/lib/session-store.ts` — fetch from server, active session tracking
8. Update `web/src/routes/+page.svelte` — session join flow, destruction handling
9. Update workspace `package.json` — add server workspace, scripts
10. Test end-to-end

## Notes

- The server runs as a standalone process: `node server/dist/index.js --port 31415`
- The extension (`extension/`) is still useful for the CLI workflow but is now **optional** — the server is the primary way to access pi remotely
- The web frontend works with both the extension (plan 1) and the server (this plan), with the server being the full-featured option
- Shared resources (auth, model registry) are created once at startup to minimize overhead
- Each session's `AgentSession` is fully independent with its own agent loop, message history, and streaming state
- The 5-minute idle timeout is configurable via `--idle-timeout` flag or `PI_IDLE_TIMEOUT` env var
- Session destruction is graceful: the session file is saved before disposal, so history is preserved
- **Graceful shutdown:** On SIGTERM/SIGINT, save all sessions and dispose them cleanly
