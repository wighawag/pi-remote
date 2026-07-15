# @wherever-dev/pi

## 0.3.1

### Patch Changes

- a4866aa: Show the context-window usage indicator ("11.3% / 1.0M") for CLI-controlled sessions as soon as a viewer joins, instead of leaving it blank until the next turn. Previously the pi extension only forwarded its context usage on `agent_end` and model switches, so an idle CLI-bridged session (no new turn since the bridge connected) had no usage snapshot to show, and the server broadcast `session_created` on `cli_register` without one. The extension now pushes a context-usage snapshot immediately after registering (on connect/reconnect), and the server includes any cached usage in the `session_created` message it broadcasts to web viewers on `cli_register`. Both are best-effort: when usage is genuinely unknown (no model or no turn yet) nothing is shown, matching the previous behavior.

## 0.3.0

### Minor Changes

- 13c2d36: Register a self-contained `attach_file` tool in the CLI-bridge extension (shipped inside the same `@wherever-dev/pi` extension, nothing extra to install). The agent calls `attach_file({ path })` to offer a file for download; the tool only validates the path and returns a normal tool result carrying it, with no dependency on the bridge and without reading the file bytes. The download button is then driven by the tool call reaching the web UI, which is why the same tool works in a pure server-side session too. The prompt directs the agent to attach not only after producing a deliverable (a PDF, an export, a report) but also whenever the user asks for a file by name or type, including one created earlier in the conversation ("give me the gpx", "send me the pdf"), since the remote user can only obtain a file the agent attaches, so a bare file path in a reply is never enough.

### Patch Changes

- 11c4dc8: Fix a crash that could take down the pi CLI (not the wherever server) when a session was torn down while the client's WebSocket was still connecting, typically when the wherever server is not running. Calling `close()` on a socket that is still in the `CONNECTING` state makes `ws` abort the handshake and emit an `'error'` event asynchronously on the next tick; because `disconnect()` had already removed every listener, that error became an unhandled `EventEmitter` error and surfaced as an `uncaughtException` ("WebSocket was closed before the connection was established"), exiting the process. The existing try/catch could not help since the error was emitted asynchronously rather than thrown synchronously. `disconnect()` now attaches a no-op `'error'` sink to the socket it is tearing down (in both the node `ws` and browser `WebSocket` environments) so the late handshake-abort error is swallowed instead of crashing pi.
- Updated dependencies [11c4dc8]
  - @wherever-dev/client@0.3.3

## 0.2.8

### Patch Changes

- 4836b65: Fix dangling tool calls being hoisted to the end of the transcript on the web frontend, showing as a phantom "series of aborted tool calls" after the latest reply.

  When loaded history contained a tool call with no matching tool result (e.g. an interrupted long-running `bash` that was superseded by a new user turn, then more replies), the web history mapping deferred every unmatched tool call and appended them all AFTER the last mapped message. So dangling calls from the MIDDLE of the conversation piled up below the latest assistant reply, even though the CLI (and the actual transcript) has them inline where they were issued. The reproducing session was a deliberate recoverability test ("Generate a long message..."/"long running tool call using bash sleep" then interrupting it).

  The mapping now renders each tool call IN PLACE at its position in the stream: a result-less tool message is emitted when the tool call is seen, and its matching tool result fills it in later (oldest-open-first per tool name, preserving the parallel-call FIFO behaviour). A call that never receives a result stays exactly where it was issued, correctly marked `interrupted` (neutral "no result" state), instead of migrating to the end. On the live streaming tail, only the newest still-open call is kept streaming ("Elapsed" ticking); earlier open calls in the window are interrupted.

  Tests: two new client tests covering (1) a mid-conversation dangling call staying in place with the final message still an assistant reply, and (2) multiple dangling calls where only the newest streams on the live tail while earlier ones are interrupted in place. All existing tool abort/interrupted/duration tests still pass.

- 9931867: Pair reconstructed tool results to their exact tool call by id, not just by tool name.

  The server now forwards the tool-call id on both `tool_call` (the id the assistant issued) and `tool_result` (the `toolCallId` it satisfies) history messages, and the web history mapping matches a result to its exact call by that id, falling back to the previous oldest-open-first per-tool-name behaviour only when no id is present (older sessions, or the synthesized `bashExecution` pair).

  This fixes mis-pairing when same-named calls interleave with some left dangling: e.g. two `bash` calls issued back-to-back where only the second returns a result. Name-FIFO alone would resolve the first call and leave the second dangling; id matching resolves the correct one and leaves the genuinely-interrupted call marked interrupted, in place.

  Tests: a new client test covering id-exact pairing (result resolves call #2 by id, leaving call #1 dangling/interrupted, order preserved).

- 676ca94: Add an inviting "agent is waiting for you" beep to both the web frontend and the CLI bridge extension.

  Both surfaces can now play a gentle sound the moment the agent finishes and is waiting for a human message, so you can look away and be called back when it is your turn. The beep is DISABLED by default on both. Each surface has a per-session toggle, and a config that sets the default for new sessions (which the per-session toggle can still override). The two surfaces are configured independently.

  Web frontend (`wherever-dev`): the chime is synthesised with the Web Audio API (a soft two-note rising interval, no bundled asset) and fires on the `isStreaming` true -> false edge for the active session. Connection Settings has a "Beep when the agent is waiting" checkbox (`beepDefault`) for the persisted default and an optional custom sound URL (`beepSoundUrl`, played via an `Audio` element, with a Test button; blank = built-in chime), both persisted in the `wherever-config` localStorage entry.

  The chat toolbar (next to "Hide Thinking" / context usage) has a tri-state per-session beep control that cycles Default -> On -> Off -> Default. Per-session choices are stored per session id (persisted in a separate `wherever-beep-overrides` localStorage map), so a session with NO explicit choice follows the global default live (changing the default updates it), while an explicit On/Off sticks to that session across session switches and reloads, unaffected by later default changes, until cleared back to Default. The default is a reactive store so toggling it in the Config menu takes effect immediately.

  CLI bridge extension (`@wherever-dev/pi`): plays a sound on the `agent_settled` event (the run has fully settled and is genuinely waiting for input, so it does not fire between chained internal turns).
  - Enabled by default when EITHER the `--remote-beep` flag is set OR `beep.enabled: true` in `~/.wherever/config.json` (the flag can only force-on, so the config file is the way to enable-by-default without passing the flag). Default off.
  - `/remote-beep [on|off]` toggles it for the current session (no argument toggles; enabling plays a sample); resets to the configured default on each session start.
  - Sound resolution, highest precedence first: `--remote-beep-command` flag, then `beep.command` in `~/.wherever/config.json`, then an auto-detected player + a system chime (`pw-play`/`paplay`/`canberra-gtk-play`/`ffplay` + freedesktop `complete.oga`, or `afplay` on macOS), then a terminal bell. The bell (`\x07`) is written to `/dev/tty` rather than stdout because pi's TUI owns stdout and can swallow an out-of-band byte; the command path exists because many terminals (e.g. WezTerm on Linux) have a silent audible bell.

  Also adds a typed `beep` section (`enabled`, `command`) to the server's `WhereverConfig` (the shared `~/.wherever/config.json` type), which the extension reads directly.

- 8536f30: Warn both the web frontend and the CLI when a CLI takeover discards an in-flight turn.

  When a `pi` CLI resumes/registers a session while the standalone server is mid-turn for a web viewer, the CLI seizes control and the server disposes its live agent. Disposing mid-turn discards the whole in-flight turn without persisting it (persistence only happens on turn completion), so the web viewer, who was watching a tool run or a reply stream, lost it silently with no explanation.

  The server now detects that the server-side agent was mid-turn at takeover and sends the attached web clients a non-fatal `session_notice` (level: warning). The web frontend renders it as a dismissible banner. The wording is tailored to what was lost: a running tool call (tracked via a per-session in-flight tool-execution count, so its result never arrives) or a streaming reply (the partial text is discarded and not saved). A takeover of an already-settled (idle) session is not flagged. The session stays attached (informational, unlike `session_interrupted`).

  The notice also states the takeover semantics accurately: once the CLI has taken over it owns the session's execution loop, so messages sent from the web frontend are relayed to the CLI rather than wresting control back. The web frontend regains control only when the CLI disconnects.

  The CLI side is covered too. On register, the server sends the taking-over CLI a `cli_takeover_interrupted` message, and the Wherever extension surfaces a single matching notice. This closes a blind spot: a still-streaming turn is never persisted, so the extension's own resumed-mid-tool-call check (which reads the saved transcript) cannot see the streaming-text case. For the tool-call case, the extension's transcript check already warns with the tool names, so the server-driven notice defers to it to avoid a duplicate.

  Also fixes the web frontend rendering a killed-then-orphaned tool call as a green success tick. When a CLI takeover kills an in-flight tool (the pi SDK aborts the run and SIGKILLs the tool's process tree, so it does not keep running in the background), the transcript keeps a dangling toolCall with no toolResult. The web history mapping now flags such a result-less, non-streaming tool call as `interrupted`, and the UI shows a neutral "interrupted, no result" state (a muted ⊘ icon, neutral border, and an explanatory output note) instead of the green ✅ "Succeeded": its outcome is genuinely unknown, neither success nor failure.

  Also cleans up the CLI's resumed-mid-run warning (the extension's dangling-tool-call widget):
  - It now counts only the TRAILING dangling tool calls (those after the last user message on the active branch), not every unsatisfied tool call in the whole session. Earlier turns' interrupted tool calls are already superseded by a later human turn and do not block auto-continue, so they were over-counted (e.g. "4 tool calls" when only 1 was actually blocking).
  - It shows a single persistent widget instead of a widget plus a duplicate transient notify.
  - Its guidance is corrected: the CLI has already taken over, so it says to send a message to retry or continue, rather than the stale "send a message to take over".

- Updated dependencies [4836b65]
- Updated dependencies [12083e5]
- Updated dependencies [db16623]
- Updated dependencies [9931867]
- Updated dependencies [8536f30]
  - @wherever-dev/client@0.3.2

## 0.2.7

### Patch Changes

- Updated dependencies [333f6ad]
- Updated dependencies [9368269]
  - @wherever-dev/client@0.3.1

## 0.2.6

### Patch Changes

- e15f5fa: Fix Abort being disabled (and the composer enabled) when joining a pi CLI session that is mid-tool-call.

  When a session is being driven by the pi CLI and you opened it in the web frontend while a long tool call was in flight, Abort showed disabled and the composer looked ready, even though the CLI was still waiting for the tool to finish. Root cause: the CLI bridge only forwarded `agent_start`/`agent_end` as they happened and registered the session with a hardcoded `isStreaming: false`, so a turn already in progress when the bridge (re)connected was invisible to the server. Now the extension reports the agent's current streaming state (`!ctx.isIdle()`) in the `cli_register` handshake, and the server honors it (and keeps the mid-turn session from being idle-reaped), so a viewer joining a running CLI session correctly sees it as streaming.

## 0.2.5

### Patch Changes

- Updated dependencies [f17f262]
- Updated dependencies [f615141]
  - @wherever-dev/client@0.3.0

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
