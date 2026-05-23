# Pi Remote

A modern, multi-session remote control platform for the [pi coding agent](https://pi.dev) consisting of a **Standalone Server**, a **Web Frontend**, and a **CLI Bridge Extension**. 

It allows you to manage multiple pi sessions concurrently across your workspace directories from a gorgeous web dashboard while keeping your terminal CLI fully synced in real-time.

```
┌────────────────────────────────────────────────────────┐
│                   Pi Remote Server                      │
│                                                        │
│  ┌──────────────┐         WebSocket        ┌────────┐  │
│  │ Web Frontend │◄────────────────────────►│  CLI   │  │
│  │  (Svelte 5)  │◄────────────┐            │ Bridge │  │
│  └──────────────┘             │            └────────┘  │
│                               ▼                        │
│                     ┌──────────────────┐               │
│                     │  Agent Sessions  │               │
│                     │ (Standalone/SDK) │               │
│                     └──────────────────┘               │
└────────────────────────────────────────────────────────┘
```

## Installation

### 1. Clone and Install Dependencies
Clone this repository and install all monorepo workspace dependencies:
```bash
git clone https://github.com/wighawag/pi-remote.git
cd pi-remote
pnpm install
```

### 2. Build the Extension and Web Dashboard
Compile both the CLI extension and the web dashboard:
```bash
pnpm build
```

### 3. Install the Extension into Pi
To make your local `pi` terminal auto-connect to the remote server on startup without needing extra flags, symlink the extension folder into Pi's local extensions directory:
```bash
mkdir -p ~/.pi/agent/extensions
ln -sf "$(pwd)/extension" ~/.pi/agent/extensions/pi-remote
```

> 📌 **Note for future release:** Once this extension package is published, manual cloning/symlinking will no longer be necessary. Users will be able to install it directly using the standard `pi` extension command (e.g., `pi --install pi-remote`). We should update these instructions once published.

---

## Quick Start

Now that you have everything installed, here is how to start and run Pi Remote:

### 1. Start the Pi Standalone Server
```bash
pnpm run server:dev
```
The Standalone Server will start listening on `http://127.0.0.1:8765`.

### 2. Run the Web Dashboard
```bash
pnpm --filter ./web dev
```
Open `http://localhost:5173` (or the IP displayed) in your browser (or phone!) to access the Pi Remote Dashboard.

### 3. Start your Terminal CLI
Simply run `pi` inside any workspace directory. It will automatically load the symlinked extension, connect to your Standalone Server, and sync with your Web Dashboard!
```bash
pi
```

---

## Architecture & Features

- **Multi-Session Management:** Run separate independent pi sessions concurrently across different projects or directories.
- **Collaborative CLI Mirroring:** Open `pi` in any directory and it automatically connects to the Standalone Server. Your CLI and Web Frontend become mirror images of each other, bidirectionally syncing user inputs, agent thinking, tool executions, and results in real-time.
- **Robust Connection Recovery:** Built-in background reconnection with exponential backoff makes the CLI and Standalone Server pair automatically whenever either process starts or restarts.
- **Headless Handover:** Close your terminal CLI, and the Standalone Server automatically transitions the session to a server-side headless session. Re-open your terminal, and control is instantly handed back to your CLI—zero data loss, zero DB lock conflicts.
- **Folder Session Browser:** Browse active or archived sessions grouped elegantly by workspace folders in your sidebar.

---

## Directory Structure

* **`server/`** — Node.js Standalone HTTP/WebSocket Server managing independent in-process SDK sessions.
* **`web/`** — Modern Svelte 5 Web Dashboard for remote chatting, folder browsing, and model configuration.
* **`extension/`** — CLI Bridge Extension that runs inside the local `pi` terminal process and acts as a sync client.

---

## Custom Settings (CLI Flags / Environment Variables)

Both the server and CLI bridge extension accept standard flags to customize ports, host bindings, and auth tokens.

### Standalone Server Settings
* `--port`, `PI_REMOTE_PORT` (Default: `8765`)
* `--host`, `PI_REMOTE_HOST` (Default: `127.0.0.1`)
* `--token`, `PI_REMOTE_TOKEN` (Optional auth token)
* `--idle-timeout`, `PI_IDLE_TIMEOUT` (Graceful shutdown timeout, default: `300000` = 5 minutes)

### CLI Bridge Settings
Whenever you run `pi`, you can override bridge defaults:
* `--remote-host` (Default: `127.0.0.1`)
* `--remote-port` (Default: `8765`)
* `--remote-token` (Auth token if configured)
* `--remote-bridge` (Set to `false` to run as offline standard CLI)

---

## License

MIT
