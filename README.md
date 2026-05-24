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

There are two ways to install and run Pi Remote: **Quick Install via NPM** (recommended for users), or **Local Development Setup** (for active contributors).

---

### Method A: Quick Install (via NPM) 🚀

This is the easiest and most robust way to run Pi Remote. No cloning or local compiling required!

#### 1. Install the Standalone Server Globally
Install the Pi Remote Standalone Server command-line tool globally using npm or your favorite package manager:
```bash
npm install -g pi-remote-server
```

#### 2. Install the CLI Extension into Pi
Use Pi's built-in package manager to install the remote connection bridge extension directly from npm:
```bash
pi install npm:pi-remote
```

#### 3. Start the Server
Start the standalone multi-session server:
```bash
pi-remote-server
```
The server will boot up and automatically generate self-signed SSL certificates for a secure `https`/`wss` local environment. Open `https://localhost:8765` in your browser. (The first time, proceed past your browser's SSL warning).

#### 4. Run Pi
Run `pi` as normal in any project folder:
```bash
pi
```
Pi will automatically detect and load the `pi-remote` extension, establish a real-time connection to your standalone server, and mirror your workspace to the Web Dashboard!

---

### Method B: Local Development Setup (From Source) 🛠️

If you want to modify the source code, develop custom features, or run pre-release code locally:

#### 1. Clone and Install Dependencies
Clone this repository and install all monorepo workspace dependencies:
```bash
git clone https://github.com/wighawag/pi-remote.git
cd pi-remote
pnpm install
```

#### 2. Build All Components
Build the frontend, copy it to the server's public asset path, and compile both TypeScript packages (server & extension) using our unified build script:
```bash
pnpm build
```

#### 3. Install the Extension via Symlink
Symlink your local compiled development extension directly into Pi's extensions directory:
```bash
mkdir -p ~/.pi/agent/extensions
ln -sf "$(pwd)/extension" ~/.pi/agent/extensions/pi-remote
```

#### 4. Start the Server in Development Mode
```bash
pnpm run server:dev
```
Open `https://localhost:8765` in your browser.

#### 5. Run Pi
Run `pi` in any directory. It will load the symlinked local extension and connect automatically!

*(Optional) **Frontend HMR:** If you are actively working on Svelte dashboard components and want Hot Module Replacement, run the Vite dev server:*
```bash
pnpm --filter ./web dev
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
* `--host`, `PI_REMOTE_HOST` (Default: `127.0.0.1`, set to `0.0.0.0` to expose to outside/local network)
* `--token`, `PI_REMOTE_TOKEN` (Optional auth token)
* `--idle-timeout`, `PI_IDLE_TIMEOUT` (Graceful shutdown timeout, default: `300000` = 5 minutes)
* `--ssl-key`, `PI_REMOTE_SSL_KEY` (Path to SSL private key file for HTTPS/WSS)
* `--ssl-cert`, `PI_REMOTE_SSL_CERT` (Path to SSL certificate file for HTTPS/WSS)
* `--no-ssl` / `--http`, `PI_REMOTE_NO_SSL` / `PI_REMOTE_HTTP` (Disables SSL, falling back to standard HTTP/WS)

### CLI Bridge Settings
Whenever you run `pi`, you can override bridge defaults:
* `--remote-host` (Default: `127.0.0.1`)
* `--remote-port` (Default: `8765`)
* `--remote-token` (Auth token if configured)
* `--remote-bridge` (Set to `false` to run as offline standard CLI)
* `--remote-secure` (Whether to connect via WSS. Default: `true`. Set to `false` if server has `--no-ssl` active)

---

## Configuration File (`~/.pi/remote/config.json`)

Pi Remote supports user configuration to customize defaults for session creation and enable automatic Git remote repository setup.

The configuration file is located at `~/.pi/remote/config.json` on the server machine.

### Configuration Properties

* **`gitInitDefault`** (boolean, Default: `false`):
  When creating a session in a non-existent folder, this defines if the **"Initialize Git repository"** option is checked by default in the web UI.

* **`commonFolders`** (array of strings, Default: `[]`):
  A list of preset folder paths (e.g. `["~/projects/my-app", "~/dev/github"]`). These folders are displayed as quick-select completion options in the session creation panel, appearing even when the path input is empty.

* **`remoteRepoRules`** (array of rule objects, Default: `[]`):
  A list of rules to automatically create a remote repository (on GitHub, Codeberg, etc.) and configure the git remote whenever a new session folder matches a RegExp pattern.

* **`uploads`** (object, Default: `{ "type": "tmp" }`):
  Configuration for local file uploads (images or documents) sent via the remote client:
  * `type` (string, optional, Default: `'tmp'`): Where to store the uploaded files on the server.
    * `'tmp'`: Saves to the operating system's temporary directory (e.g. `/tmp`).
    * `'session'`: Saves inside the active session's workspace directory (`cwd`), under a sub-folder.
    * `'custom'`: Saves to a specified custom directory on the server.
  * `subDir` (string, optional, Default: `'.pi-remote/uploads'`): The relative directory to use when `type` is set to `'session'`.
  * `dir` (string, optional): The absolute or tilde-expanded (e.g. `~/uploads`) folder path to use when `type` is set to `'custom'`.

### Rule Object Properties
Each rule in `remoteRepoRules` can contain:
* `pattern` (string, required): A regular expression matched against the absolute resolved path of the folder.
* `provider` (string, required): The git hosting provider (`'github'`, `'codeberg'`, `'gitea'`, or `'forgejo'`).
* `visibility` (string, optional, Default: `'private'`): Visibility of the repository on the remote host (`'private'` or `'public'`).

### Example Configuration

```json
{
  "gitInitDefault": true,
  "commonFolders": [
    "~/projects/my-app",
    "~/dev/github"
  ],
  "remoteRepoRules": [
    {
      "pattern": ".*/projects/github/.*",
      "provider": "github",
      "visibility": "private"
    },
    {
      "pattern": ".*/projects/codeberg/.*",
      "provider": "codeberg",
      "visibility": "private"
    }
  ],
  "uploads": {
    "type": "session",
    "subDir": ".pi-remote/uploads"
  }
}
```

### Auto-Remote Repository Creation Mechanics
When a new session folder is created and matches a rule:
1. If the folder is not already a Git repository, the server automatically initializes it (`git init`).
2. The server executes your configured provider's CLI client locally to create the repository remotely:
   - For **GitHub**, it runs `gh repo create "<repo-name>" --private --source=. --remote=origin` (this requires `gh` CLI to be installed and authenticated).
   - For **Codeberg/Gitea/Forgejo**, it executes `tea repo create --name "<repo-name>" --private` or `cb repo create --name "<repo-name>" --private` (requires `tea` or `cb` CLI tools, automatically adding the corresponding remote URL under `origin`).
3. This sets up the local repo to point directly to your remote origin, allowing your Pi Remote agent to push directly when asked!

---

## Remote Access & Security (Tailscale, Headscale, & Outside Access)

By default, the Standalone Server binds to `127.0.0.1` (localhost) for security. If you want to access your Pi Remote instance from outside or from other devices (like a mobile phone or tablet), you have a few options:

### 1. Tailscale / Headscale (Highly Recommended)
Using a secure private mesh VPN like [Tailscale](https://tailscale.com) or [Headscale](https://github.com/juanfont/headscale) is the safest and easiest way to access your Pi Remote server without exposing ports to the public internet.
1. Install Tailscale/Headscale on both your Pi and your remote client device (e.g., your phone).
2. Start the Pi Remote server binding to all interfaces (or your specific Tailscale IP):
   ```bash
   pi-remote-server --host 0.0.0.0 --token your-secure-token
   ```
   *Warning: Always use a strong `--token` when binding to any interface other than localhost!*
3. Access your Svelte dashboard securely from your remote device's browser at `https://<your-tailscale-ip>:8765` with your token.

### 2. Local Network Access
To allow access from devices on your local home network (Wi-Fi):
1. Start the server binding to `0.0.0.0`:
   ```bash
   pi-remote-server --host 0.0.0.0 --token your-secure-token
   ```
2. Find your Pi's local network IP (e.g., `192.168.1.50`) and open `https://192.168.1.50:8765` in your client's browser.
3. If running the CLI `pi` command from another computer on the same local network, point it to the Pi:
   ```bash
   pi --remote-host 192.168.1.50 --remote-token your-secure-token
   ```

### 3. SSH Port Forwarding
For an ad-hoc secure connection without exposing any port:
```bash
ssh -L 8765:localhost:8765 user@your-pi-ip
```
Once connected, you can open `https://localhost:8765` locally on your client computer.

---

## License

MIT
