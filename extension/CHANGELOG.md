# @wherever-dev/pi

## 0.2.4

### Patch Changes

- 326f8a2: Fix duplicate parallel sessions when switching between the CLI and the web frontend.

  Root cause was a pi SDK version skew: the standalone server and the CLI-bridge extension were pinned to `@earendil-works/pi-coding-agent@^0.75.3`, while the user's `pi` binary had moved to 0.80.x. pi >=0.80 canonicalizes the cwd (resolving trailing slashes and `.`/`..` segments) before encoding the session directory name, whereas <0.80 encoded the raw cwd. Because the server keys its in-memory session map by the session file path, the 0.75-built server and the 0.80 CLI produced two different path strings for the same logical session, so the browser and the terminal ended up attached to two separate tracked sessions.

  Changes:
  - Bump the server and extension to `@earendil-works/pi-coding-agent@^0.80.3` (and pin `@earendil-works/pi-ai` to `^0.80.3`) so both sides use the same session-directory encoding as a modern pi CLI.
  - Harden the pool against any future version skew: a new `normalizeSessionFile()` canonicalizes the session file path at every map-key boundary (`registerCliSession`, `unregisterCliSession`, `handleCliEvent`, `getSession`, `loadSession`, `createNewSession`, and the active-session lookup in the session listing), so a CLI-reported path and a server-computed path converge on one key regardless of trailing slashes, `.`/`..` segments, or an SDK mismatch.

## 0.2.3

### Patch Changes

- 891ba73: Warn when the CLI resumes a session mid-tool-call. When a session is actively running in the web frontend (a tool call in flight) and the user joins via the pi CLI (`/resume`), the loaded transcript ends with an assistant `tool_use` that has no matching `toolResult`. pi cannot auto-continue from that state, so the CLI silently sat idle as if the turn were complete. The extension now detects a dangling tool call on the active branch at `session_start` (resume/reload/startup) and surfaces it via a notification and a status widget, so the user understands why nothing is happening (the result may still be running in another client) instead of mistaking it for a finished turn. The warning clears when the agent next runs or on session shutdown. This is a detection-and-surface mitigation; preserving the live run on join (observer-on-resume) is tracked in `work/briefs/ready/cli-observer-on-resume-of-live-session.md`.
- Updated dependencies [cf11972]
- Updated dependencies [605693a]
- Updated dependencies [f9080e1]
- Updated dependencies [caabb92]
  - @wherever-dev/client@0.2.2

## 0.2.2

### Patch Changes

- f3c6c43: Add a client-side stale-socket liveness watchdog so a half-open WebSocket to the relay no longer hangs the connected agent forever.

  A half-open TCP connection (peer vanished without a clean FIN/RST: relay restart, network blip, dropped upstream) leaves the socket in `ESTAB` and fires neither `close` nor `error`, so the client's existing reconnect machinery was never triggered and the agent waited on the dead socket indefinitely (recoverable only by restarting the relay). `WhereverClient` now:
  - records `lastInboundAt` on every inbound frame (any frame, including the `pong` reply, counts as proof of life);
  - runs a periodic app-level `{type:'ping'}` keepalive so a healthy connection stays warm even during long, token-less model turns;
  - runs a watchdog that, when the socket has been silent past a threshold (~60s, comfortably above the keepalive interval), forcibly `terminate()`s/`close()`s the dead socket and calls the existing `scheduleReconnect()`.

  This reuses the existing exponential-backoff reconnect logic (the only thing missing was the trigger), so a wedged agent now self-heals in ~60s by reconnecting instead of requiring a manual relay restart. The watchdog timers are torn down on `close`/`disconnect`, and the socket is nulled before `terminate()` so the normal `close` handler does not double-fire a reconnect. Implements Slice A of `work/observations/ws-half-open-connection-hangs-agent-no-heartbeat.md`.

- 3a430c7: Show context-window usage in the session top bar, like the pi CLI (e.g. `11.3% / 1.0M`).

  The dashboard now surfaces how much of the model's context window the active session is using, next to the model indicator. It updates live as turns complete and when the model changes.
  - **Server-managed sessions:** the server reads usage from pi's `AgentSession.getContextUsage()` and broadcasts a new `context_usage` message after each turn / message / model switch, and includes an initial snapshot on `session_created`.
  - **CLI-bridged sessions:** the server cannot run the agent, so the pi extension forwards its `ctx.getContextUsage()` on `agent_end` and model change; the relay caches and broadcasts it the same way.
  - **Display:** percentage of the context window used over the humanized window size (`1.0M`, `200K`, ...), matching the pi CLI. Right after compaction (when token count is momentarily unknown) it shows `– / <window>`. The value clears when leaving a session.

- 2aee118: Add a `sessions.readOnly` config option and a separate, observe-only Read-only sessions page.

  Building on `sessions.ignore` (which fully hides + skips folders), `sessions.readOnly` takes the same glob syntax but treats matching folders differently: they are **hidden from the main session list** (and, like `ignore`, skipped before their file bodies are read on the main view, so they do not slow it down), yet remain viewable on a dedicated **Read-only sessions** page reached via a link in the sidebar.

  ```json
  { "sessions": { "ignore": ["/tmp/**"], "readOnly": ["~/.agent-runner/**"] } }
  ```

  This is aimed at autonomous agent fleets (e.g. `agent-runner` working directories) you want to watch but not drive:
  - `GET /sessions?view=readonly` returns only the read-only folders, each tagged `readOnly`.
  - The Read-only page reuses the session browser but hides the create form and all delete controls.
  - Opening a read-only session is **forced read-only end-to-end**: the server sets the client read-only (so `message` sends are refused) and reports it in `session_created`; the dashboard then hides the composer entirely, showing an "observing only" notice.

  When `sessions.readOnly` is empty or omitted, behaviour is unchanged.

- 123b6a3: Add a per-turn transport-stall timeout and liveness observability to the WebSocket relay.

  Builds on the stale-socket watchdog (Slice A) and server heartbeat (Slice B):
  - **Per-turn stall timeout (client).** While a turn is streaming, the watchdog now uses a shorter deadline (`TURN_STALL_MS`, 45s) than the idle stale-socket threshold (60s). The keepalive pong should keep traffic flowing during a turn, so this distinguishes a merely slow model (heartbeat still arriving, not stale) from a dead transport (heartbeat stopped). On a mid-turn stall it surfaces a recoverable `sessionError` ("Connection to relay stalled mid-turn; reconnecting...") and clears `isStreaming` before reconnecting, instead of silently parking mid-stream.
  - **Idempotent re-register on reconnect.** Confirmed already handled: the extension re-sends `cli_register` on every `connected` state edge, which the watchdog reconnect re-triggers, so a vanished-and-returned client re-attaches cleanly.
  - **Observability (pi-remote half).** The client logs stale-socket teardowns, reconnect attempts, and successful reconnects; the server logs each reaped dead socket with its client/session context. A hung agent now shows up as an event rather than as silence.

  Implements Slice C and the pi-remote half of Slice D of `work/observations/ws-half-open-connection-hangs-agent-no-heartbeat.md`. The `agent-runner` wrapper change in Slice D is intentionally left to the agent-runner repo.

## 0.2.1

### Patch Changes

- 37de34b: Extract core client WebSocket and state management logic into a dedicated, framework-agnostic `@wherever-dev/client` monorepo package. Update both the web dashboard (`@wherever-dev/web`) and the CLI extension (`@wherever-dev/pi`) to use the new shared client, reducing duplicate code and establishing a modular architecture for future integrations.
- Updated dependencies [37de34b]
- Updated dependencies [ffd28c7]
  - @wherever-dev/client@0.2.1

## 0.0.5

### Patch Changes

- 393e8aa: update to port 31415

## 0.0.4

### Patch Changes

- a697a2d: Ensure model choices are preserved across page reloads, server restarts, and synchronized dynamically between web and CLI.

  Specifically:
  - Fixed an issue where the model resolved to the first (oldest) model_change entry on session reload/restart instead of the most recent one.
  - Added model_select event propagation so that changing the model in a CLI session dynamically updates any connected web client.
  - Added support in the CLI bridge extension to receive and apply model changes initiated from the remote web dashboard.

## 0.0.3

### Patch Changes

- a0120e2: Fix auto-scrolling bug by guarding the force-scroll effect to trigger only when the active session's file actually changes, rather than on every state/token update.

## 0.0.2

### Patch Changes

- 2b2a81e: Add the ability to send images and documents by uploading them to a configurable server-side folder and appending their absolute paths to the user's message so the agent can read and process them.
- dda50b5: Add hint on the main screen stating that the sidebar can be used to open existing/running sessions.
  - format files

- 696abee: auto-completion path
- e890743: Add support for executing bash commands directly from the Svelte web frontend using the `!` prefix (e.g., `!ls`, `!!git status`), matching the pi CLI's interactive behavior.
  - Intercepts prompts starting with `!` or `!!` on the server and runs them through the active AgentSession's executeBash or forwards them as `cli_bash` messages to the CLI bridge client.
  - Streams tool execution chunk updates back to the Svelte client in real-time.
  - Captures output and exit status and persists them to the session log as a `bashExecution` history message.
  - Supports raw output streaming of direct shell command executions.

- ce9aff8: Document all advanced features in the main README and enrich the USAEG guide with HTTP endpoints and WebSocket events.
- bf81616: git remote repo creation

## 0.0.1

### Patch Changes

- first release
