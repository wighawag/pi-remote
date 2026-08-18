# Wherever — Architecture and API Guide

Welcome to the **Wherever** documentation. This guide details how the multi-session standalone server, the Svelte web frontend, and the CLI bridge extension interact, including full REST and WebSocket API specifications.

---

## 1. Architecture Overview

```
                               ┌───────────────────┐
                               │   Web Frontend    │
                               │    (Svelte 5)     │
                               └─────────┬─────────┘
                                         │
                                   HTTP / WebSocket
                                         │
                                         ▼
┌──────────────┐  WebSocket    ┌───────────────────┐
│ CLI Terminal │◄─────────────►│ Wherever Server   │
│ (Bridge Ext) │               │   (Standalone)    │
└──────────────┘               └─────────┬─────────┘
                                         │
                                    In-Process
                                         │
                                         ▼
                               ┌───────────────────┐
                               │   Pi SDK Agent    │
                               │    (Headless)     │
                               └───────────────────┘
```

The system operates in one of two states for a given session:

### Headless Mode (Standard Server-side Agent)
When no physical terminal CLI is open, the Standalone Server runs a headless instance of the pi agent using the Pi SDK. You can communicate with the agent entirely from the web frontend, and the server executes commands and logs responses.

> 💡 **No Pi CLI Dependency:** You do **not** need the `pi` CLI installed globally on your machine to use Headless Mode. The `wherever-dev` standalone server directly depends on and executes `@earendil-works/pi-coding-agent` (the Pi SDK) in-process.

### Bridge Mode (Terminal CLI Sync)
When you run `pi` in a local directory, the **CLI Bridge Extension** connects to the server and registers itself.
* **Handover:** The server shuts down its headless agent and transfers execution authority to your CLI.
* **Terminal Control:** The terminal CLI drives the agent. All inputs, outputs, and tool executions in your terminal are mirrored on the web dashboard.
* **Remote Commands:** Typing in the web UI forwards commands to the CLI process to execute inside your visual terminal.
* **Auto-Recovery:** If the CLI exits, the server resumes headless control instantly. If the connection drops, the extension automatically reconnects in the background using an exponential backoff.

> ⚠️ **Bridge Mode Limitation:** When executing in Bridge Mode, the `pi` CLI process in your terminal takes exclusive control of the session's execution loop ("brain operation"). Quitting or killing the `pi` CLI process (e.g. via `Ctrl+C` or closing your terminal) will immediately interrupt any active conversation or running tools, even if you are viewing or interacting with it on the web frontend. This is an architectural limitation of the `pi` CLI.

> ℹ️ **CLI Takeover Notice:** If a `pi` CLI resumes a session while the standalone server is **mid-turn** for a web viewer, the CLI seizes control and the server discards that in-flight turn without persisting it (persistence only happens when a turn completes). The web frontend now surfaces a dismissible warning banner so the viewer understands why the running turn stopped, tailored to what was lost: a running **tool call** (its result never arrives) or a streaming **reply** (the partial text is discarded and not saved). Previously the web viewer's turn would just stop with no explanation. A takeover of an already-settled (idle) session is not flagged, since nothing was in flight.
>
> Once the CLI has taken over, it **owns** the session's execution loop: anything you send from the web frontend is relayed to the CLI (it does not wrestle control back). The web frontend regains control only when that CLI process disconnects (e.g. you quit it), at which point the server resumes headless control of the session.
>
> The CLI side is warned too. When it takes over a mid-turn session, the server tells it explicitly, so the CLI surfaces a matching notice (tool-call result lost, or streaming reply discarded). This covers the streaming-text case that the CLI could not otherwise detect: a still-streaming turn is never persisted, so the CLI's own resumed-mid-tool-call check (which reads the saved transcript) sees nothing. For the tool-call case, the CLI's transcript check already warns with the tool names, so the server notice defers to it to avoid a duplicate.

---

## 2. HTTP REST API Reference

The standalone server binds to `127.0.0.1:31415` by default.

### `GET /health`
Check if the server is up and responsive.
* **Auth required:** No
* **Response (200 OK):**
  ```json
  {
    "status": "ok",
    "timestamp": 1716490000000
  }
  ```

### `GET /sessions`
List all active and archived sessions grouped by workspace directory.
* **Auth required:** Yes (if token is set)
* **Response (200 OK):**
  ```json
  {
    "folders": [
      {
        "path": "/home/user/my-project",
        "name": "my-project",
        "sessions": [
          {
            "path": "/home/user/.pi/agent/sessions/xyz.json",
            "id": "xyz",
            "name": "Refactor codebase",
            "created": "2026-05-23T12:00:00.000Z",
            "modified": "2026-05-23T12:30:00.000Z",
            "messageCount": 14,
            "firstMessage": "Refactor all endpoints to async/await",
            "isActive": true,
            "clientCount": 2
          }
        ]
      }
    ],
    "activeSessions": [
      {
        "sessionId": "xyz",
        "sessionFile": "/home/user/.pi/agent/sessions/xyz.json",
        "cwd": "/home/user/my-project",
        "model": "anthropic:claude-3-5-sonnet",
        "clientCount": 2,
        "isIdle": true,
        "createdAt": 1716490000000,
        "lastActivity": 1716491800000
      }
    ]
  }
  ```

### `GET /models`
Fetch all LLM models currently configured and available in Pi's local ModelRegistry.
* **Auth required:** Yes
* **Response (200 OK):**
  ```json
  {
    "models": [
      {
        "provider": "anthropic",
        "modelId": "claude-3-5-sonnet",
        "label": "Anthropic: Claude 3.5 Sonnet",
        "isDefault": true
      }
    ]
  }
  ```

### `POST /session/new`
Create a brand new session inside a directory.
* **Auth required:** Yes
* **Request Body:**
  ```json
  {
    "cwd": "/home/user/my-project",
    "model": "anthropic:claude-3-5-sonnet"
  }
  ```
* **Response (201 Created):**
  ```json
  {
    "sessionId": "abc123xyz",
    "sessionFile": "/home/user/.pi/agent/sessions/abc123xyz.json",
    "cwd": "/home/user/my-project",
    "model": "anthropic:claude-3-5-sonnet"
  }
  ```

### `POST /session/model`
Change the active LLM model on a running session.
* **Auth required:** Yes
* **Request Body:**
  ```json
  {
    "sessionId": "abc123xyz",
    "model": "openai:gpt-4o"
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "status": "changed",
    "model": "openai:gpt-4o"
  }
  ```

### `POST /session/destroy`
Gracefully close and clean up an active session (saved database states are untouched).
* **Auth required:** Yes
* **Request Body:**
  ```json
  {
    "sessionId": "abc123xyz"
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "status": "destroyed"
  }
  ```

### `POST /session/upload`
Upload a document or image to the server via standard HTTP multipart POST.
* **Auth required:** Yes (if token is configured)
* **Form Data Parameters:**
  * `sessionId`: The session identifier (UUID or custom ID).
  * `file`: The binary file upload (image or document).
* **Response (200 OK):**
  ```json
  {
    "status": "uploaded",
    "filename": "screenshot.png",
    "savedPath": "/absolute/path/to/server-storage/screenshot.png"
  }
  ```

### `GET /session/download`
Download a file the agent produced (the reverse of `/session/upload`). The server streams the file with `Content-Disposition: attachment`. This is what makes file mentions in the chat tappable/downloadable from a phone or browser.
* **Auth required:** Yes (if token is configured)
* **Query Parameters:**
  * `sessionId`: The session identifier the download is attributed to (used to resolve the working directory).
  * `path`: The file to download. Relative paths resolve against the session's `cwd`; absolute/`~` paths are allowed only if inside an allowed root.
* **Security (deny-by-default):** A file is served ONLY when its real (symlink-resolved) path is inside an allowed root. Allowed roots are always the session's `cwd` and the resolved upload dir, plus any extra roots in `downloads.roots`. `..` traversal and in-tree symlinks that escape a root are rejected. A path outside the roots returns `404` (indistinguishable from not-found, so existence is not leaked).
* **Config (`~/.wherever/config.json`):**
  ```json
  {
    "downloads": {
      "enabled": true,
      "roots": ["~/exports"],
      "maxBytes": 104857600
    }
  }
  ```
  Set `"enabled": false` to disable downloads entirely (the endpoint then returns `403`).
* **Responses:** `200` streams the file; `400` missing params; `404` not found / not allowed; `413` file exceeds `maxBytes`.

**Downloading from the UI.** The download button is driven by the tool CALL itself: the web UI inspects each tool call and, for a few file-oriented tools, renders a download button in the tool-card header that hits `GET /session/download`. This works in both CLI-bridge and pure server-side (web-frontend) sessions, since both stream tool calls to every client. There is no separate protocol message.

- **`attach_file` (agent-driven, the intended path):** a self-contained tool the agent calls to offer a specific file for download, e.g. right after producing a deliverable, or when you ask for a file by name/type, including one created earlier ("give me the gpx", "send me the pdf"). It is registered in every session type: for server-side sessions the server passes it as a `customTool` into `createAgentSession()`; for CLI-bridge sessions the same `@wherever-dev/pi` extension you already load registers it (nothing extra to install). Its prompt tells the agent that, for a remote user who cannot reach the filesystem, a bare file path in a reply is never enough, it must call `attach_file`.
- **`read`/`write`/`edit` cards (opportunistic, no agent cooperation):** these cards already carry the exact path the agent touched, so a download button is offered there too. If the agent read/wrote a file, you can grab it.

### `POST /session/transcribe`
Send a raw WAV voice recording to be transcribed using the configured server-side transcription API (e.g., Zhipu GLM-ASR-2512 or OpenAI Whisper).
* **Auth required:** Yes (if token is configured)
* **Request Body:** Raw binary WAV audio data stream.
* **Response (200 OK):**
  ```json
  {
    "text": "Hello, please list files in my directory."
  }
  ```

---

## 3. WebSocket API Protocol

Establish a connection via `ws://127.0.0.1:31415/ws?token=YOUR_TOKEN`.

Optionally add `&clientKey=YOUR_STABLE_KEY` (max 128 chars): a stable identity for one viewer, reused across reconnects. When a new connection arrives with a key that is already registered, the server sends the older connection a `connection_superseded` message and retires it (detaching it from its session) instead of treating it as an additional viewer. A client that actually receives `connection_superseded` is alive, so it must regenerate its key before reconnecting, otherwise two viewers sharing a key would evict each other indefinitely. Keys longer than 128 characters are ignored (with a server-side warning), leaving that connection without supersede protection. This is what keeps a reconnect after a silent drop (phone sleep, network switch) from being mistaken for a second viewer, which would otherwise turn "new session in this folder" into a read-only folder conflict. Use one key per independent viewer (the web app uses one per browser tab).

### Client $\rightarrow$ Server Messages

```typescript
// Join or load a session file
{
  "type": "session_load",
  "sessionFile": "/home/user/.pi/agent/sessions/xyz.json",
  "cwd": "/home/user/my-project"
}

// Create and join a new session
{
  "type": "session_new",
  "cwd": "/home/user/my-project"
}

// Send user message
{
  "type": "message",
  "message": "Write a rust test for my module",
  "sessionId": "abc123xyz",
  // OPTIONAL. True while the sender is in a SPOKEN conversation (the web app sets
  // it when its conversation-mode and speak-replies knobs are both on). It only
  // tells the agent, for this turn, to also emit a short spoken `say` reply
  // alongside its written answer; the message text is delivered verbatim.
  // Absent/false means off, which is the default behaviour.
  "conversationMode": true
}

// Abort current execution
{
  "type": "abort",
  "sessionId": "abc123xyz"
}

// Change model
{
  "type": "model_change",
  "model": "anthropic:claude-3-5-sonnet"
}

// Send file upload via Base64 over WebSocket (Bypasses CORS/SSL warning blocks)
{
  "type": "file_upload",
  "uploadId": "upload123",
  "sessionId": "abc123xyz",
  "filename": "diagram.png",
  "data": "data:image/png;base64,iVBORw0KGgoAAA..."
}

// "Continue anyway" on the folder-conflict warning banner: lift read-only for
// the current session so it can send even though another session in the same
// folder is active. Does NOT abort/take over the other session.
{
  "type": "folder_conflict_continue",
  "sessionId": "abc123xyz"
}
```

### Server $\rightarrow$ Client Messages

```typescript
// Initial connection confirmation
{
  "type": "connected",
  "clientId": "r790dfb9273"
}

// Session loaded or created successfully
{
  "type": "session_created",
  "sessionId": "abc123xyz",
  "sessionFile": "/home/user/.pi/agent/sessions/abc123xyz.json",
  "cwd": "/home/user/my-project",
  "model": "openai:gpt-4o"
}

// Session message history load (sent immediately on joining a session)
{
  "type": "message_history",
  "sessionId": "abc123xyz",
  "messages": [
    { "role": "user", "content": "hello", "timestamp": 1716490000000 },
    { "role": "assistant", "content": "How can I help you?", "timestamp": 1716490005000 }
  ]
}

// Streaming text deltas
{
  "type": "message_update",
  "sessionId": "abc123xyz",
  "delta": " Sure, here"
}

// Streaming reasoning/thinking deltas
{
  "type": "thinking_update",
  "sessionId": "abc123xyz",
  "delta": "Analyzing directory structure..."
}

// Message generation finalized
{
  "type": "message_end",
  "sessionId": "abc123xyz",
  "content": "Sure, here is your file.",
  "role": "assistant"
}

// Tool start
{
  "type": "tool_start",
  "sessionId": "abc123xyz",
  "toolName": "bash",
  "args": { "command": "cargo test" }
}

// Streaming tool stdout/stderr chunk updates
{
  "type": "tool_update",
  "sessionId": "abc123xyz",
  "toolName": "bash",
  "delta": "running 2 tests..."
}

// Tool end
// `images` is optional and only present when a tool result carried image
// content blocks (e.g. `read` on an image file). Each entry is base64 `data`
// plus its `mimeType`, so clients can render the image inline.
{
  "type": "tool_end",
  "sessionId": "abc123xyz",
  "toolName": "bash",
  "isError": false,
  "result": "test result output...",
  "images": [{ "mimeType": "image/png", "data": "<base64>" }]
}

// File upload confirmation
{
  "type": "file_uploaded",
  "uploadId": "upload123",
  "sessionId": "abc123xyz",
  "filename": "diagram.png",
  "savedPath": "/absolute/path/to/diagram.png"
}
```

---

## 4. Troubleshooting and Security

### Folder Overlap Warning Banner
If you load or start a session in `/project-a` while another client already has an active session in that same directory, the Standalone Server does **not** block you with a dialog. Instead it attaches you as a **read-only observer** and shows a non-blocking **warning banner**:
* **Observing (default):** You see all agent updates, tool executions, and logs in real-time, but message input is disabled while you observe. A message sent anyway is refused with a visible `session_error`, never silently dropped.
* **Continue anyway:** Lifts read-only so you can send into the session. The other session is **not** interrupted or taken over — both run concurrently (changes may conflict). The banner then remains as a passive warning and disappears automatically once no other session is active in the folder.

There is no longer any take-over / abort protection: the server sends a live `folder_conflict` update as sessions open and leave the folder, driving the banner's appearance and dismissal. That update carries the server's authoritative `readOnly` for the receiving client, so read-only is released automatically when the conflict resolves rather than outliving the banner that could lift it. Every `folder_conflict_continue` is answered with one of these updates on the same socket, which by ordering settles any conflicting update that was already in flight. Note that a conflict is tracked per CLIENT: asking for a new session in an occupied folder attaches you to the occupant's own session file, so the banner stays up for exactly as long as the other client is still there.

### Security Reminders
* **Bind Binding:** By default, the Standalone Server binds only to `127.0.0.1`. Never expose to `0.0.0.0` unless you set a highly secure `--token` in your startup configuration.
* **Tailscale / Headscale (Highly Recommended):** For a secure private network, you can use Tailscale or Headscale. Bind the server to all interfaces with `--host 0.0.0.0` and access it safely over your private mesh VPN:
  ```bash
  wherever --host 0.0.0.0 --token your-secure-token
  ```
* **Tunnels:** For remote access (such as mobile browsing) without exposing ports, you can utilize secure SSH tunnels:
  ```bash
  ssh -L 31415:localhost:31415 user@your-server-ip
  ```
