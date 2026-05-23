# Pi Remote — Architecture and API Guide

Welcome to the **Pi Remote** documentation. This guide details how the multi-session standalone server, the Svelte web frontend, and the CLI bridge extension interact, including full REST and WebSocket API specifications.

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
│ CLI Terminal │◄─────────────►│ Pi Remote Server  │
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

### Bridge Mode (Terminal CLI Sync)
When you run `pi` in a local directory, the **CLI Bridge Extension** connects to the server and registers itself.
* **Handover:** The server shuts down its headless agent and transfers execution authority to your CLI.
* **Terminal Control:** The terminal CLI drives the agent. All inputs, outputs, and tool executions in your terminal are mirrored on the web dashboard.
* **Remote Commands:** Typing in the web UI forwards commands to the CLI process to execute inside your visual terminal.
* **Auto-Recovery:** If the CLI exits, the server resumes headless control instantly. If the connection drops, the extension automatically reconnects in the background using an exponential backoff.

---

## 2. HTTP REST API Reference

The standalone server binds to `127.0.0.1:8765` by default.

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

---

## 3. WebSocket API Protocol

Establish a connection via `ws://127.0.0.1:8765/ws?token=YOUR_TOKEN`.

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
  "sessionId": "abc123xyz"
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

// Tool end
{
  "type": "tool_end",
  "sessionId": "abc123xyz",
  "toolName": "bash",
  "isError": false,
  "result": "test result output..."
}
```

---

## 4. Troubleshooting and Security

### Workspace Conflict Dialog
If you try to load a session in `/project-a` while another browser client has an active session open in that same directory, the Standalone Server detects the directory overlap and presents a **Conflict Resolution Dialog**:
* **Take Over:** Swaps the active workspace controller to your session, sending a `session_interrupted` notice to the other client (re-routing them into Read-Only Mode).
* **Read-Only:** Places you in standard observer mode. You can view all agent updates, tool executions, and logs in real-time, but your message inputs are disabled.

### Security Reminders
* **Bind Binding:** By default, the Standalone Server binds only to `127.0.0.1`. Never expose to `0.0.0.0` unless you set a highly secure `--token` in your startup configuration.
* **Tunnels:** For remote access (such as mobile browsing), we recommend utilizing secure SSH tunnels:
  ```bash
  ssh -L 8765:localhost:8765 user@your-server-ip
  ```
