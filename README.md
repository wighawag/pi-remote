# Wherever

A modern, multi-session remote control platform for the [pi coding agent](https://pi.dev) consisting of a **Standalone Server** (`wherever-dev`), a **Web Frontend**, and a **CLI Bridge Extension** (`@wherever-dev/pi`).

It allows you to manage multiple pi sessions concurrently across your workspace directories from a gorgeous web dashboard while keeping your terminal CLI fully synced in real-time.

```
┌────────────────────────────────────────────────────────┐
│                   Wherever Server                      │
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

---

## Key Features Breakdown

### 🔄 Collaborative CLI Mirroring & Reconnection

- **Bidirectional Sync:** The terminal CLI process and Svelte web dashboard mirror each other's inputs, agent reasoning/thinking steps, tool execution starts, tool outputs, and results in real-time.
- **Auto-Recovery:** Built-in background reconnection with exponential backoff guarantees that the CLI bridge and Standalone Server automatically pair up whenever either process starts or restarts.

### 🔌 Seamless Headless / Bridge Handover

- **Continuous Flow:** Close your terminal CLI, and the Standalone Server automatically transitions the active session to a server-side headless session running on the Pi SDK.
- **Zero Disruption:** Re-open your terminal CLI, and control is instantly handed back to your CLI—with zero data loss, zero database lock conflicts, and perfect continuity.
- **Bridge Mode Interruption Limitation:** When running in Bridge Mode, the active `pi` CLI process in your terminal maintains exclusive control of the executing agent's loop ("brain operation"). If you quit or close the `pi` CLI (e.g. via `Ctrl+C` or closing your terminal window), any active conversation, run, or tool execution will be immediately interrupted, even if you are interacting with it from the web dashboard. This is a design limitation of the `pi` CLI architecture.

### 🎙️ WAV Dictation & Speech-to-Text (Voice Control)

- **Direct PCM Web Audio Capture:** Bypasses heavy `MediaRecorder` browser encoding, streaming raw audio chunks directly to an in-memory buffer for instant, zero-latency WAV creation.
- **Audible Chime Cue:** Emits a synthesized starting beep so you know exactly when the microphone is listening and when to speak.
- **Dual Gesture Control:** Supports both standard click-to-start/stop recording or hold-to-talk (walkie-talkie style) controls.
- **Color-Coded Feedback:** Features distinct pulsing red indicators for active recording and solid orange/yellow indicators during cloud processing & downsampling.
- **Dual Transcription Engines:** Transcribe locally using the browser’s Web Speech API, or route to highly accurate server-side cloud speech-to-text engines (configured to Zhipu GLM-ASR-2512 or any OpenAI-compatible Whisper endpoint).

### 💻 Direct Bash Execution (`!` and `!!`)

- **Terminal Power:** Execute bash commands directly from the Svelte web frontend by prefixing them with `!` or `!!` (e.g., `!ls`, `!!git status`), matching the pi CLI's interactive behavior.
- **Real-Time Streaming:** Streams tool execution stdout/stderr chunks back to the dashboard in real-time, capturing output and exit codes directly into the session history.

### 📁 Multi-Modal File & Image Uploads

- **Rich Context Support:** Upload documents, screenshots, and diagrams for multi-modal agent processing, automatically appending absolute paths to your active message box.
- **Secure Hybrid Transport:** Upload via Base64 over WebSockets (immune to mobile browser self-signed SSL certificate blocks or CORS limitations) or standard HTTP multipart POST.
- **Custom Storage Backends:** Highly configurable file target backends, allowing you to save files to `/tmp`, store them directly within the session's workspace (`cwd`) under a custom subdirectory (e.g. `.wherever/uploads`), or save them to a custom absolute directory on the server.

### 🔍 Smart Path Autocomplete & Verification

- **Path Suggestions:** Autocompletes folder path inputs on session creation from preset lists (`commonFolders`) and real-time directory lookups.
- **Folder Validation:** Instantly queries path status to verify if the directory exists and check if it is already initialized as a Git repository.

### 🐙 Automatic Git & Remote Repo Setup

- **Automatic Init:** Automatically runs `git init` on newly created folders that are not already under git source control.
- **CLI Remote Provisioning:** When a folder matches configured regular expression rules, the server automatically executes the provider's CLI (such as `gh` for GitHub, or `tea`/`cb` for Gitea/Codeberg/Forgejo) to provision a new public or private repository on the host, setting up your `origin` remote automatically.

### 🗂️ Polished Folder Browser & Sidebar

- **Folder Grouping:** Displays active and archived sessions grouped neatly by folder.
- **Collapsible Trees:** Folders are compressed by default to keep the sidebar extremely clean.
- **Inline Deletion:** Support for direct session deletion with an inline double-confirmation step, syncing deletions across all connected clients.
- **Unified Search:** Search and filter active or archived sessions by title, first message, or workspace folder names.

### 🛑 Collision & Conflict Resolution

- **Directory Overlap Protection:** If you open a workspace in one browser tab while another tab (or device) is actively driving it, the server triggers a **Conflict Resolution Dialog**.
- **Take Over / Read-Only:** Choose to **Take Over** control (which places the other client into Read-Only Observer Mode) or join as **Read-Only** (to view agent steps, logs, and inputs safely in real-time without interfering).

### 📱 Mobile-Optimized UX & Layout Locks

- **Visual Viewport Constraining:** Lock page overscroll bouncing specifically tuned for mobile browsers (Firefox/Safari) to prevent visual breakages during keyboard popups and text inputs.
- **Collapsible Text Input:** Expand or collapse the chat input area on demand for maximum readability and space efficiency on small screens. Click to automatically focus and expand.
- **Input Queueing:** If you type and send a message while the agent is currently streaming or processing a tool, the input is queued and automatically submitted the instant the agent finishes.

---

## Installation

There are two ways to install and run Wherever: **Quick Install via NPM** (recommended for users), or **Local Development Setup** (for active contributors).

> 💡 **Note on Pi Installation:** You do **not** need the `pi` CLI installed globally to use Wherever in **Headless Mode** (running agent sessions entirely from the web frontend). The standalone server (`wherever-dev`) runs the Pi agent in-process using the Pi SDK. You only need the `pi` CLI if you want to use **Bridge Mode** to sync a terminal CLI session in real-time.

### Method A: Quick Install (via NPM) 🚀

This is the easiest and most robust way to run Wherever. No cloning or local compiling required!

#### 1. Install the Standalone Server Globally

Install the Wherever Standalone Server command-line tool globally:

```bash
npm install -g wherever-dev
```

#### 2. Install the CLI Extension into Pi (Optional — Only for Terminal Bridge Mode)

If you want to sync a terminal CLI session in real-time, install the remote connection bridge extension using Pi's package manager:

```bash
pi install npm:@wherever-dev/pi
```

#### 3. Start the Server

Start the standalone multi-session server:

```bash
wherever
```

The server will boot up and automatically generate self-signed SSL certificates for a secure `https`/`wss` local environment. Open `https://localhost:31415` in your browser. (The first time, proceed past your browser's SSL warning).
_(Note: Automatic certificate generation requires `openssl` to be installed on your host system. If `openssl` is missing, the server will gracefully fall back to HTTP/WS)._

_The self-signed certificate is fine for everyday use, but browsers will not treat it as a secure context, which prevents installing the dashboard as a standalone PWA from a remote device. To enable a proper standalone PWA install over Tailscale, see [Trusted HTTPS for Tailscale](#trusted-https-for-tailscale-recommended-for-pwa-install)._

#### 4. Run Pi (Optional — Only for Terminal Bridge Mode)

To connect your local terminal CLI to the Standalone Server, run `pi` as normal in any project folder:

```bash
pi
```

Pi will automatically detect and load the `@wherever-dev/pi` extension, establish a real-time connection to your standalone server, and mirror your workspace to the Web Dashboard!

Note though that when pi cli run, it takes control of the brain operation and quiting (via ctrl+c, /quit, etc...) will interupt the conversation even on every devices

#### 5. Run as a Background Service (Optional)

Instead of keeping a terminal open, you can install Wherever as a background service that starts automatically and restarts on failure:

```bash
wherever install
```

This installs and starts a per-user service (a **systemd** user unit on Linux, or a **launchd** LaunchAgent on macOS). It also adds the `@wherever-dev/pi` extension to `~/.pi/agent/settings.json` for you (unless it is already configured), so a running `pi` CLI bridges into the server automatically.

Server flags are baked into the service, so you can pass them through at install time:

```bash
wherever install --host 0.0.0.0 --token your-secure-token --port 31415
```

Other subcommands:

```bash
wherever service-status   # show whether the service is running
wherever uninstall        # stop and remove the service
```

Install options:

- `--system` — Install a system-wide service instead of a per-user one (Linux only, requires root).
- `--no-pi-config` — Do not modify `~/.pi/agent/settings.json`.
- `--port` / `--host` / `--token` — Server flags to bake into the service invocation.
- `--dry-run` — Print the generated unit/plist and the intended actions without writing anything.

> On Linux user services, run `loginctl enable-linger $USER` if you want the service to keep running after you log out. Windows is not supported yet; run `wherever` manually or use a tool like NSSM.

---

### Method B: Local Development Setup (From Source) 🛠️

If you want to modify the source code, develop custom features, or run pre-release code locally:

#### 1. Clone and Install Dependencies

Clone this repository and install all monorepo workspace dependencies:

```bash
git clone https://github.com/wighawag/wherever.git
cd wherever
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
ln -sf "$(pwd)/extension" ~/.pi/agent/extensions/wherever
```

#### 4. Start the Server in Development Mode

```bash
pnpm run server:dev
```

Open `https://localhost:31415` in your browser.

#### 5. Run Pi (Optional — Only for Terminal Bridge Mode)

If you want to sync your terminal CLI with the standalone server, run `pi` in any directory. It will load the symlinked local extension and connect automatically!

_(Optional) **Frontend HMR:** If you are actively working on Svelte dashboard components and want Hot Module Replacement, run the Vite dev server:_

```bash
pnpm --filter ./web dev
```

---

## Directory Structure

- **`server/`** — Node.js Standalone HTTP/WebSocket Server managing independent in-process SDK sessions.
- **`web/`** — Modern Svelte 5 Web Dashboard for remote chatting, folder browsing, and model configuration.
- **`extension/`** — CLI Bridge Extension that runs inside the local `pi` terminal process and acts as a sync client.

---

## Custom Settings (CLI Flags / Environment Variables)

Both the server and CLI bridge extension accept standard flags to customize ports, host bindings, and auth tokens.

### Standalone Server Settings

- `--port`, `PI_REMOTE_PORT` (Default: `31415`)
- `--host`, `PI_REMOTE_HOST` (Default: `127.0.0.1`, set to `0.0.0.0` to expose to outside/local network)
- `--token`, `PI_REMOTE_TOKEN` (Optional auth token)
- `--idle-timeout`, `PI_IDLE_TIMEOUT` (Graceful shutdown timeout, default: `300000` = 5 minutes)
- `--ssl-key`, `PI_REMOTE_SSL_KEY` (Path to SSL private key file for HTTPS/WSS)
- `--ssl-cert`, `PI_REMOTE_SSL_CERT` (Path to SSL certificate file for HTTPS/WSS)
- `--no-ssl` / `--http`, `PI_REMOTE_NO_SSL` / `PI_REMOTE_HTTP` (Disables SSL, falling back to standard HTTP/WS)

### CLI Bridge Settings

Whenever you run `pi`, you can override bridge defaults:

- `--remote-host` (Default: `127.0.0.1`)
- `--remote-port` (Default: `31415`)
- `--remote-token` (Auth token if configured)
- `--remote-bridge` (Set to `false` to run as offline standard CLI)
- `--remote-secure` (Whether to connect via WSS. Default: `true`. Set to `false` if server has `--no-ssl` active)

---

## Configuration File (`~/.wherever/config.json`)

Wherever supports user configuration to customize defaults for session creation and enable automatic Git remote repository setup.

The configuration file is located at `~/.wherever/config.json` on the server machine.

### Configuration Properties

- **`gitInitDefault`** (boolean, Default: `false`):
  When creating a session in a non-existent folder, this defines if the **"Initialize Git repository"** option is checked by default in the web UI.

- **`commonFolders`** (array of strings, Default: `[]`):
  A list of preset folder paths (e.g. `["~/projects/my-app", "~/dev/github"]`). These folders are displayed as quick-select completion options in the session creation panel, appearing even when the path input is empty.

- **`remoteRepoRules`** (array of rule objects, Default: `[]`):
  A list of rules to automatically create a remote repository (on GitHub, Codeberg, etc.) and configure the git remote whenever a new session folder matches a RegExp pattern.

- **`uploads`** (object, Default: `{ "type": "tmp", "method": "websocket" }`):
  Configuration for local file uploads (images or documents) sent via the remote client:
  - `type` (string, optional, Default: `'tmp'`): Where to store the uploaded files on the server.
    - `'tmp'`: Saves to the operating system's temporary directory (e.g. `/tmp`).
    - `'session'`: Saves inside the active session's workspace directory (`cwd`), under a sub-folder.
    - `'custom'`: Saves to a specified custom directory on the server.
  - `subDir` (string, optional, Default: `'.wherever/uploads'`): The relative directory to use when `type` is set to `'session'`.
  - `dir` (string, optional): The absolute or tilde-expanded (e.g. `~/uploads`) folder path to use when `type` is set to `'custom'`.
  - `method` (string, optional, Default: `'websocket'`): File transport method. Set to `'websocket'` for secure Base64 WebSocket transfer or `'post'` to fallback to HTTP multipart POST.

- **`speech`** (object, optional):
  Configuration for cloud speech-to-text transcription:
  - `apiKey` (string, optional): API Key for the cloud transcription provider. Can also be set via the `SPEECH_API_KEY` environment variable.
  - `apiUrl` (string, optional, Default: `'https://api.z.ai/api/paas/v4/audio/transcriptions'`): The cloud transcription HTTP endpoint. Can also be set via the `SPEECH_API_URL` environment variable.
  - `model` (string, optional, Default: `'glm-asr-2512'`): Model ID for transcription (e.g., Whisper models). Can also be set via the `SPEECH_MODEL` environment variable.

- **`sessions`** (object, optional):
  Controls which sessions appear in the dashboard's session list.
  - `ignore` (array of glob strings, Default: `[]`): Session working directories matching any of these globs are fully excluded from the list. Crucially, a matching folder is skipped **before** its session files are read, so a large pile of throwaway sessions (e.g. agent scratch dirs under `/tmp`) no longer slows down the session list. Globs support `*` (does not cross a path separator), `**` (crosses separators), and `?`; `~` is expanded to the home directory. A pattern ignores both the directory itself and everything nested under it (so `"/tmp"`, `"/tmp/*"`, and `"/tmp/**"` all ignore `/tmp` and everything inside it). Omitting `ignore` (or leaving it empty) changes nothing.
  - `readOnly` (array of glob strings, Default: `[]`): Same glob syntax as `ignore`. Sessions whose working directory matches are **hidden from the main session list** (and, like `ignore`, their folders are skipped before their bodies are read on the main view, so they do not slow it down), but remain viewable on a separate **Read-only sessions** page reached via a link in the sidebar. Opening one is forced read-only: the server refuses messages and the dashboard hides the composer, so it is an observe-only view. This is intended for autonomous agent fleets (e.g. `agent-runner` working directories) that you want to watch but not drive from the dashboard.

### Rule Object Properties

Each rule in `remoteRepoRules` can contain:

- `pattern` (string, required): A regular expression matched against the absolute resolved path of the folder.
- `provider` (string, required): The git hosting provider (`'github'`, `'codeberg'`, `'gitea'`, or `'forgejo'`).
- `visibility` (string, optional, Default: `'private'`): Visibility of the repository on the remote host (`'private'` or `'public'`).

### Example Configuration

```json
{
  "gitInitDefault": true,
  "commonFolders": ["~/projects/my-app", "~/dev/github"],
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
    "subDir": ".wherever/uploads",
    "method": "websocket"
  },
  "speech": {
    "apiKey": "your-cloud-speech-api-key",
    "apiUrl": "https://api.z.ai/api/paas/v4/audio/transcriptions",
    "model": "glm-asr-2512"
  },
  "sessions": {
    "ignore": ["/tmp/**"],
    "readOnly": ["~/.agent-runner/**"]
  }
}
```

### Auto-Remote Repository Creation Mechanics

When a new session folder is created and matches a rule:

1. If the folder is not already a Git repository, the server automatically initializes it (`git init`).
2. The server executes your configured provider's CLI client locally to create the repository remotely:
   - For **GitHub**, it runs `gh repo create "<repo-name>" --private --source=. --remote=origin` (this requires `gh` CLI to be installed and authenticated).
   - For **Codeberg/Gitea/Forgejo**, it executes `tea repo create --name "<repo-name>" --private` or `cb repo create --name "<repo-name>" --private` (requires `tea` or `cb` CLI tools, automatically adding the corresponding remote URL under `origin`).
3. This sets up the local repo to point directly to your remote origin, allowing your Wherever agent to push directly when asked!

---

## Remote Access & Security (Tailscale, Headscale, & Outside Access)

By default, the Standalone Server binds to `127.0.0.1` (localhost) for security. If you want to access your Wherever instance from outside or from other devices (like a mobile phone or tablet), you have a few options:

### 1. Tailscale / Headscale (Highly Recommended)

Using a secure private mesh VPN like [Tailscale](https://tailscale.com) or [Headscale](https://github.com/juanfont/headscale) is the safest and easiest way to access your Wherever server without exposing ports to the public internet.

1. Install Tailscale/Headscale on both your machine and your remote client device (e.g., your phone).
2. Start the Wherever server binding to all interfaces (or your specific Tailscale IP):
   ```bash
   wherever --host 0.0.0.0 --token your-secure-token
   ```
   _Warning: Always use a strong `--token` when binding to any interface other than localhost!_
3. Access your Svelte dashboard securely from your remote device's browser at `https://<your-tailscale-ip>:31415` with your token.

#### Trusted HTTPS for Tailscale (recommended for PWA install)

The server's auto-generated certificate is **self-signed** (issued for `CN=localhost`). Browsers will load the dashboard after you click past the warning, but they do **not** treat a self-signed origin as a _secure context_. As a result:

- **Installing the dashboard as a PWA** (Add to Home Screen) will not launch in its own standalone window: it opens in a normal browser tab instead.
- Chrome's _Application → Manifest_ panel reports `Page is not served from a secure origin`, and Lighthouse shows no PWA category.

To get a genuinely trusted origin (and a working standalone PWA), use Tailscale's built-in HTTPS to issue a real Let's Encrypt certificate for your MagicDNS name. This requires **HTTPS** and **MagicDNS** to be enabled for your tailnet (see the Tailscale admin console → DNS).

Replace `your-machine.your-tailnet.ts.net` below with your device's MagicDNS name (`tailscale status` shows it).

**Method A — explicit flags:**

```bash
# Issue a cert for your MagicDNS name (writes <name>.crt and <name>.key)
tailscale cert your-machine.your-tailnet.ts.net

wherever --host 0.0.0.0 --token your-secure-token \
  --ssl-cert your-machine.your-tailnet.ts.net.crt \
  --ssl-key  your-machine.your-tailnet.ts.net.key
```

**Method B — drop-in (no flags needed):**

The server auto-loads `~/.wherever/certs/localhost.crt` + `~/.wherever/certs/localhost.key` when present, and only generates a self-signed pair if they are **missing**. So you can write the Tailscale cert directly to those paths and the server will pick it up automatically on the next start:

```bash
tailscale cert \
  --cert-file ~/.wherever/certs/localhost.crt \
  --key-file  ~/.wherever/certs/localhost.key \
  your-machine.your-tailnet.ts.net

wherever --host 0.0.0.0 --token your-secure-token
```

_(The filenames stay `localhost.*` but contain a cert for your MagicDNS name; the server only cares about the path, not the name.)_

Then open `https://your-machine.your-tailnet.ts.net:31415` (the **name**, not the IP — the cert is bound to the name). The origin is now trusted, so the PWA installs and launches standalone.

> **Renewal:** `tailscale cert` certificates are short-lived (Let's Encrypt, ~90 days). The server reads the certificate files only at startup, so to renew, re-run the `tailscale cert` command (overwriting the files) and restart `wherever`.
>
> **DNS note:** all devices (including the server host itself) must be able to resolve the MagicDNS name. If `getent hosts your-machine.your-tailnet.ts.net` fails on the server while `nslookup your-machine.your-tailnet.ts.net 100.100.100.100` succeeds, your system DNS is bypassing Tailscale's MagicDNS resolver (commonly a NetworkManager / `systemd-resolved` `/etc/resolv.conf` conflict). See [tailscale.com/s/dns-fight](https://tailscale.com/s/dns-fight).

### 2. Local Network Access

To allow access from devices on your local home network (Wi-Fi):

1. Start the server binding to `0.0.0.0`:
   ```bash
   wherever --host 0.0.0.0 --token your-secure-token
   ```
2. Find your Pi's local network IP (e.g., `192.168.1.50`) and open `https://192.168.1.50:31415` in your client's browser.
3. If running the CLI `pi` command from another computer on the same local network, point it to the Pi:
   ```bash
   pi --remote-host 192.168.1.50 --remote-token your-secure-token
   ```

### 3. SSH Port Forwarding

For an ad-hoc secure connection without exposing any port:

```bash
ssh -L 31415:localhost:31415 user@your-pi-ip
```

Once connected, you can open `https://localhost:31415` locally on your client computer.

---

## License

MIT
