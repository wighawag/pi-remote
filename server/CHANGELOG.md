# wherever-dev

## 0.8.0

### Minor Changes

- fe11760: Support `!sudo ...` bash commands from the web client, for both server-hosted sessions and CLI-bridge sessions. When a `!`-command (or `!!`-command) starts with `sudo`, the server defers execution and asks the web client for the password via a new one-shot, masked prompt (a `bash_sudo_prompt` -> `bash_sudo_password`/`bash_sudo_cancel` protocol round-trip). Once the password arrives, a server session runs the command locally and a CLI-bridge session forwards it to the extension (new `cli_bash_sudo` message); in both cases the command runs with `sudo -S -k -p ''`, feeding the password over the child's stdin, and streams output/records history exactly like any other `!command`. The password is used once and is never streamed, logged, or persisted (only the password-free command line is recorded). A fresh prompt is required for every invocation (`-k` resets any cached sudo credential). Cancelling the prompt drops the command without running anything.

  Also fixes pre-existing UX bugs affecting all `!`/`!!` bash commands from the web client. Because the server runs them as a bash tool call instead of delivering them to the agent, there is no user-message echo to confirm: the delivery watchdog wrongly flagged them as failed (a spurious retry/discard banner) and re-surfaced them as failed user bubbles on reload. Web `!`/`!!` commands no longer add any local user-message echo at all (the bash tool call is the feedback), so there is no banner and nothing reappears after a reload. The server now also marks force-command bash tool calls explicitly (`forceCommand`), both live and in reloaded history, so the web auto-expands their output reliably, including for back-to-back `!command`s and after a reload.

## 0.7.1

### Patch Changes

- a4866aa: Show the context-window usage indicator ("11.3% / 1.0M") for CLI-controlled sessions as soon as a viewer joins, instead of leaving it blank until the next turn. Previously the pi extension only forwarded its context usage on `agent_end` and model switches, so an idle CLI-bridged session (no new turn since the bridge connected) had no usage snapshot to show, and the server broadcast `session_created` on `cli_register` without one. The extension now pushes a context-usage snapshot immediately after registering (on connect/reconnect), and the server includes any cached usage in the `session_created` message it broadcasts to web viewers on `cli_register`. Both are best-effort: when usage is genuinely unknown (no model or no turn yet) nothing is shown, matching the previous behavior.
- fe99d43: Keep the scroll position anchored when loading older messages. Previously, clicking "Load older messages" preserved the distance from the bottom, which could visually shift the content the user was reading once the older window was prepended. Now the client records the message that was first before the load and, after the older messages are prepended, scrolls so that same message stays in place near the top of the viewport, leaving a small gap above it that reveals the newly loaded messages. If the anchor message can't be located after the prepend, it falls back to the previous "preserve distance from bottom" behavior so the content never jumps unexpectedly.

## 0.7.0

### Minor Changes

- 13c2d36: Add a file download mechanism so agent-produced files (e.g. a generated PDF saved into the work folder) can be pulled down to a phone/browser. New authenticated `GET /session/download?sessionId=..&path=..` endpoint streams the file with `Content-Disposition: attachment`, guarded deny-by-default: a file is served only when its real (symlink-resolved) path is inside an allowed root (always the session cwd and the resolved upload dir, plus `config.downloads.roots`), so `..` traversal and in-tree symlink escapes are rejected. Configurable via a new `downloads` block (`enabled`, `roots`, `maxBytes`).

  The download button in the web UI is driven by the tool CALL itself: the client inspects each tool call and, for a small set of file-oriented tools, renders a download button in the tool-card header (building an authenticated URL against the active session). This works identically in CLI-bridge and pure server-side (web-frontend) sessions, since both already stream tool calls to every client, so no side-channel message is needed. `attach_file` is the intended, agent-driven trigger; `read`/`write`/`edit` cards also offer a button opportunistically. The server additionally registers `attach_file` as a `customTool` on its own `createAgentSession()` sessions so the tool exists in web-frontend sessions that have no CLI bridge.

### Patch Changes

- 817aa93: Fix a session-routing bug where a message could be delivered to the wrong session's agent (you switch to a session, post a message, and the agent replies as if it were in a different session). The web client already stamps every send with the `sessionId` of the session it is actually viewing, but the server ignored it and routed by its own per-connection `client.sessionId`, which is only (re)attached when a `session_load` completes. During a switch/reconnect/resync window that value could be stale (a reconnected socket even starts with no attachment, and a cold load attaches only seconds later inside the async agent-build step), so the message went to whatever session the connection was previously attached to.

  The `message` and `abort` WS handlers now treat the client-stamped `msg.sessionId` as authoritative: they resolve it through the session pool and verify it maps to the same tracked session the connection is attached to. On a mismatch the send is refused with a `session_error` (surfaced by the client as a recoverable, retryable failure via its delivery watchdog + Retry) instead of being misrouted into another session's agent. Adds an end-to-end regression test (`server/test/message-session-authority.test.ts`) that reproduces the misroute and asserts it is now refused, and that a correctly-stamped send is still delivered.

## 0.6.2

### Patch Changes

- 30db572: Fix the server test harness, which spawned the server without the required `start` verb. Since the explicit verb dispatch was introduced, a bare invocation prints usage and exits, so `/health` never came up and every gate test failed with "server did not become healthy". The harness now passes `start`, and the full suite (6 files, 11 tests) is green again.
- f1ccbcc: Chat rendering improvements: user messages now linkify bare URLs (http(s):// and www.) into clickable links without reinterpreting other characters as markdown, and long fenced code blocks (triple backtick) in assistant messages render as collapsible `<details>` showing the language plus a truncated first line so they no longer clutter the log. Single-line code blocks stay expanded.

## 0.6.1

### Patch Changes

- 3d193f3: `wherever install` now forwards all server flags directly, no separator needed. Install owns only `--system`, `--no-pi-config`, and `--dry-run`; every other argument is passed verbatim to the baked `wherever start` command. So `wherever install --host 0.0.0.0 --port 31415 --http-localhost-fallback` works, and any server flag (`--host`, `--port`, `--token`, `--http-localhost-fallback`, `--no-ssl`, `--ssl-key`, `--idle-timeout`, ...) can be baked into the service without install modelling each one. A leading `--` separator is still tolerated (and ignored) for backward compatibility. On Linux, re-running `install` now also restarts the running service so the freshly written options take effect immediately (previously `enable --now` left an already-running process on the old `ExecStart` until the next restart), mirroring the launchd unload+load behavior on macOS.
- 3d193f3: Add a `wherever --version` command (with `-v` and `version` aliases) that prints the installed package version. The version is read at runtime from the package's own `package.json` next to the entrypoint, so it reports correctly regardless of how the CLI was launched (npm, a Volta shim, or an absolute service path). The version line is also listed in `wherever help`.

## 0.6.0

### Minor Changes

- 0d7ca65: Add `wherever install` / `uninstall` / `service-status` subcommands to run the server as a background service.

  On Linux it writes a systemd unit (a per-user unit under `~/.config/systemd/user/` by default, or a system-wide unit with `--system`) and enables/starts it. On macOS it writes and loads a per-user launchd LaunchAgent under `~/Library/LaunchAgents/`. Server flags like `--port`, `--host`, and `--token` are baked into the service invocation.

  On install (unless `--no-pi-config`) the `npm:@wherever-dev/pi` extension is added to the `packages` array in `~/.pi/agent/settings.json` if it is not already configured, so a running pi CLI bridges into the same server automatically. The existing settings file is backed up to `settings.json.bak` before it is modified. A `--dry-run` flag prints the unit/plist and the actions without writing anything.

  The server is now started with an explicit verb: `wherever start [server flags]`. A bare `wherever` prints the command help instead of starting the server (breaking change; acceptable pre-1.0). All existing server flags work unchanged after `start`. Windows is not supported yet; the command prints the manual steps instead.

## 0.5.3

### Patch Changes

- 4836b65: Fix dangling tool calls being hoisted to the end of the transcript on the web frontend, showing as a phantom "series of aborted tool calls" after the latest reply.

  When loaded history contained a tool call with no matching tool result (e.g. an interrupted long-running `bash` that was superseded by a new user turn, then more replies), the web history mapping deferred every unmatched tool call and appended them all AFTER the last mapped message. So dangling calls from the MIDDLE of the conversation piled up below the latest assistant reply, even though the CLI (and the actual transcript) has them inline where they were issued. The reproducing session was a deliberate recoverability test ("Generate a long message..."/"long running tool call using bash sleep" then interrupting it).

  The mapping now renders each tool call IN PLACE at its position in the stream: a result-less tool message is emitted when the tool call is seen, and its matching tool result fills it in later (oldest-open-first per tool name, preserving the parallel-call FIFO behaviour). A call that never receives a result stays exactly where it was issued, correctly marked `interrupted` (neutral "no result" state), instead of migrating to the end. On the live streaming tail, only the newest still-open call is kept streaming ("Elapsed" ticking); earlier open calls in the window are interrupted.

  Tests: two new client tests covering (1) a mid-conversation dangling call staying in place with the final message still an assistant reply, and (2) multiple dangling calls where only the newest streams on the live tail while earlier ones are interrupted in place. All existing tool abort/interrupted/duration tests still pass.

- 12083e5: Render an aborted tool call as interrupted, not a red error.

  When you hit the web "abort" button while tools are running, pi kills the in-flight tools and surfaces each as an errored result with a trailing "...aborted" status ("Command aborted" for bash, "Operation aborted" for edit/write). The web then rendered that as a red error tick, as if the tool had genuinely failed. With parallel tool calls this was especially confusing: a tool that happened to finish just before the abort showed a green success tick while the killed one showed a red error, even though the user aborted the whole turn.

  The client now detects an abort result (an errored result whose trailing status line is "...aborted") and renders it with the neutral "interrupted" state (muted icon, neutral border) instead of a red error, on both the live tool_end path and when reconstructing from loaded history. A tool that genuinely completed keeps its green success, and a genuine failure keeps its red error. The match is anchored to the trailing status line, so ordinary command output that merely contains the word "aborted" is not misclassified.

  Also fixes a related mismatch with PARALLEL same-named tools. Live tool_end frames were matched to a tool message by name via a last-match search, so with two concurrent bash calls both tool_end frames could land on the same message, leaving the other tool stuck streaming; it was then finalized by the agent_end sweep with no result and shown as a bogus green success tick. tool_end now claims the OLDEST still-streaming tool of that name (FIFO), so each concurrent call settles a distinct message. And any tool still streaming when the turn ends (agent_end) is now marked interrupted rather than left to render green, since its outcome is unknown.

  Also adds a `tool-calls` (parallel tool_use) behavior to the test fake LLM to exercise concurrent tool execution.

- b87f1bc: Search mode: let the user pick the model before searching, and make the default folder-aware.

  The main-page search composer now shows a compact model picker (same list as the sidebar new-session picker). The selection is seeded from the search folder's default model, which the server now resolves against that folder's own settings (a folder-local harness/pi config default wins over the server global). The chosen model is threaded through `runSearch` into session creation, so a search runs on the selected model instead of always falling back to the global default. The top-bar magnifier needs no separate control: it just focuses the same composer.

  Server: `getAvailableModels(cwd?)` now resolves `isDefault` against an optional folder, a new `getDefaultModelFor(cwd)` returns a folder's default as `provider:modelId`, and `GET /config` includes `searchDefaultModel` for the configured search folder.

- db16623: Render `read`-tool image output inline in the web frontend, mirroring the CLI's inline image display.

  When the agent uses the builtin `read` tool on an image path, the pi tool result carries an image content block (`{type:'image', data, mimeType}`) alongside the text note. Previously the server's `extractToolResult` kept only text blocks, so the web never saw the image. The server now also pulls image blocks out of the tool result and ships them (base64 + mimeType) on the `tool_end` frame via a new optional `images` field, and reconstructs them from history when a session is reloaded. The client stores them on the `ChatMessage` (`images`), and the web renders each image inline right under the tool header, always visible (not hidden behind the collapse toggle), while the textual arguments/output stay collapsible. Click an image to open it full size. Text-only tools are unaffected.

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

## 0.5.2

### Patch Changes

- 333f6ad: Never silently lose a message when the connection drops mid-send; confirm delivery and recover it on reload.

  A frame handed to a socket that reports OPEN can still never reach the server (a half-open TCP connection: `send()` buffers locally and does not throw, but the bytes never land). The optimistic echo was treated as delivered, the input was cleared, and on reload the message was gone with no way to recover it.

  Outbound user messages are now tracked as `delivery: 'sending'` until the server echoes them back (`message_end` role:user), at which point they are confirmed. If no echo arrives within a window, the message flips to `delivery: 'failed'` and the UI surfaces "Not delivered" with Retry / Discard instead of a normal-looking sent message. Unconfirmed messages are persisted per session, so a reload reconciles them against the loaded history: anything the server actually persisted is shown as delivered, and anything it did not is re-surfaced as a recoverable failed message (never silently dropped). New client APIs: `resendMessage(id)` and `discardMessage(id)`.

- 0976c2e: Steer the agent immediately on a mid-stream submit, matching pi's default.

  Submitting a message while the agent is streaming now steers it right away (the server injects it at the next tool/step boundary, before the next LLM call) instead of parking it in a local queue that waits for the whole turn to resolve. The primary button is renamed "Queue" -> "Steer" and the surrounding copy is aligned to pi's language ("Agent is working, Steer to interrupt"). The local `queuedText` wait-then-send and the `isStreaming`-driven auto-drain (and the "Unqueue" button) are removed; this also eliminates the "pi stops midway" auto-fire mechanism (see docs/adr/0003). The submit decision is now a pure, unit-tested helper (`web/src/lib/core/compose-send.ts`), and the hard-won safety is preserved: text is kept on a dropped send, per-session drafts persist, and disconnected/resyncing/agent-pending surface clear states instead of silently swallowing a message.

- 9368269: Show how long each tool call has been running, like the pi CLI.

  A running tool now shows a live-ticking "Elapsed N.Ns" and, once it finishes, "Took N.Ns" (one decimal, matching the CLI's bash duration format). The client reducer stamps `startedAt` on `tool_start` and `endedAt` on `tool_end` (new `ChatMessage` fields), and freezes a still-running tool's `endedAt` if the turn ends or is aborted without a `tool_end`, so the timer stops instead of counting up forever. The web UI ticks only while a tool is actually running (no per-frame work on an idle session).

  Durations also survive a reload/reconnect: history mapping pairs each `tool_call` with its `tool_result` and derives `startedAt`/`endedAt` from their timestamps (no server change needed), so a tool restored from loaded history shows the same "Took N.Ns" as a live-streamed one.

## 0.5.1

### Patch Changes

- e15f5fa: Fix Abort being disabled (and the composer enabled) when joining a pi CLI session that is mid-tool-call.

  When a session is being driven by the pi CLI and you opened it in the web frontend while a long tool call was in flight, Abort showed disabled and the composer looked ready, even though the CLI was still waiting for the tool to finish. Root cause: the CLI bridge only forwarded `agent_start`/`agent_end` as they happened and registered the session with a hardcoded `isStreaming: false`, so a turn already in progress when the bridge (re)connected was invisible to the server. Now the extension reports the agent's current streaming state (`!ctx.isIdle()`) in the `cli_register` handshake, and the server honors it (and keeps the mid-turn session from being idle-reaped), so a viewer joining a running CLI session correctly sees it as streaming.

- 2701c07: Fix the composer showing the web-search input while a session is still loading.

  The bottom composer decided it was in "search mode" purely from `!sessionFile`, ignoring the loading/resyncing/hash state. So during a session open (spinner showing "Loading session..." in the message area) the composer would render the search text box and "Search" button, an inconsistent, confusing state. Search mode is now derived from a single shared `isSearchActive` helper that also treats a session that is loading, resyncing, or targeted by the URL hash as "not the search state", so the composer and the message area always agree.

  Also adds a `vitest` unit-test tier to the `web` package covering the view-mode logic.

## 0.5.0

### Minor Changes

- f17f262: Make opening a session fast, and add the deterministic fake-LLM integration gate.

  Opening a session no longer blocks on building the live agent. Previously `session_load` awaited `createAgentSession` (which resolves extensions and connects MCP servers, seconds of work, occasionally hanging past the client's load watchdog) before sending anything, so returning to an idle-evicted session was slow and could time out. Now the server reads the session header + transcript cheaply and sends `session_created` (with a new `pending` flag) + `message_history` immediately, then builds the agent asynchronously and sends a new `session_ready` message. The client renders and lets you scroll the conversation right away; only the composer stays disabled (with a "Preparing the session agent..." banner) until the agent is ready. A failed cold build degrades to readable-but-not-sendable instead of a hard load failure. Warm (still-resident) sessions skip the pending phase entirely.

  Also raised the default session idle-eviction window from 5 to 20 minutes (`PI_IDLE_TIMEOUT`, ms) so a dip-in/dip-out user usually returns to a warm session with no agent rebuild at all.

  Foundation: promoted the fake-LLM test substrate (ADR 0001) into `server/test/` and wired `vitest` into the `server` and `client` packages, giving a deterministic, offline integration gate (real server + real pi + fake Anthropic-Messages SSE server). New coverage: server integration tests for fast-first load and a client reducer test for the pending/ready lifecycle.

  Protocol: `session_created` gains an optional `pending` flag and there is a new `session_ready` server message. Both are additive and backward compatible (an older client that ignores them simply treats the load as before, seeing history once and the composer enabled on `session_created`).

### Patch Changes

- f615141: Fix three frontend session-lifecycle bugs and add the first client unit tests.
  - Creating a new session no longer spins the blocking "Creating session..." overlay forever when the server reply is lost (slow git init / remote-repo creation, a half-open socket, or an error before the reply is sent). A create watchdog now mirrors the existing load watchdog: it clears the overlay and surfaces a recoverable error instead of forcing a reload.
  - Returning to the app (PWA/mobile) after a background suspend no longer flashes the new-session / search empty-state or the big "Not connected" panel over an already-loaded conversation. `suspend()` now correctly reflects the disconnected state so `resume()` actually rejoins in place (it was silently no-op'ing on a stale connected flag and falling through to a session-dropping reconnect). The chat view keeps the cached messages visible during a reconnect, with a thin "Reconnecting and syncing session..." banner over the composer; the sidebar and top-bar search stay usable, and only sending into that one session is blocked.
  - An UNSOLICITED socket drop (tab switch, network blip, laptop sleep, half-open reap) no longer silently detaches the frontend from a still-running session. Previously the reconnect neither re-issued `session_load` nor preserved the cached session, so the relay reconnected but the session stream was dead: the UI froze on a stale tool call with "Abort" disabled and no "connecting"/"loading" hint while the agent kept working headless, recoverable only by reload. Now the auto-reconnect preserves the cached conversation, shows the resyncing banner during the backoff, re-attaches to the active session on open, and restores the true streaming state (re-enabling Abort) from the server.
  - Added `vitest` to the `client` package with unit tests covering the create watchdog, the suspend/resume-keeps-session invariants, and unsolicited-reconnect re-attachment.

## 0.4.3

### Patch Changes

- 326f8a2: Fix duplicate parallel sessions when switching between the CLI and the web frontend.

  Root cause was a pi SDK version skew: the standalone server and the CLI-bridge extension were pinned to `@earendil-works/pi-coding-agent@^0.75.3`, while the user's `pi` binary had moved to 0.80.x. pi >=0.80 canonicalizes the cwd (resolving trailing slashes and `.`/`..` segments) before encoding the session directory name, whereas <0.80 encoded the raw cwd. Because the server keys its in-memory session map by the session file path, the 0.75-built server and the 0.80 CLI produced two different path strings for the same logical session, so the browser and the terminal ended up attached to two separate tracked sessions.

  Changes:
  - Bump the server and extension to `@earendil-works/pi-coding-agent@^0.80.3` (and pin `@earendil-works/pi-ai` to `^0.80.3`) so both sides use the same session-directory encoding as a modern pi CLI.
  - Harden the pool against any future version skew: a new `normalizeSessionFile()` canonicalizes the session file path at every map-key boundary (`registerCliSession`, `unregisterCliSession`, `handleCliEvent`, `getSession`, `loadSession`, `createNewSession`, and the active-session lookup in the session listing), so a CLI-reported path and a server-computed path converge on one key regardless of trailing slashes, `.`/`..` segments, or an SDK mismatch.

## 0.4.2

### Patch Changes

- e132f93: Make installed PWAs pick up new versions, and add a Reload button to the connection settings panel.

  An installed PWA is a hash-routed SPA and almost never issues a `navigate` request, so the service worker's skipWaiting-on-navigate trick never fired and a freshly deployed worker stayed stuck in the `waiting` state. The idle-gated update check also rarely ran right after a relaunch, so the "new version available" popup never appeared. The service worker registration now calls `registration.update()` immediately and on every `visibilitychange` to visible (relaunch / tab re-show), so the manual update popup is surfaced. The manual popup is kept (no silent auto-update).

  Also adds a Reload button to the web app's connection settings panel for forcing a fresh page load.

## 0.4.1

### Patch Changes

- 81c552f: Add an automated npm publish (approve) flow via Changesets and GitHub Actions. Landing a changeset on `main` opens/updates a "Version Packages" PR; approving and merging that PR builds every package and runs `changeset publish` to npm. Publishing uses npm Trusted Publishing (OIDC, no `NPM_TOKEN`) with provenance, so each published package (`wherever-dev`, `@wherever-dev/client`, `@wherever-dev/pi`) must register this repo + `release.yml` as a trusted publisher. Adds `build:all` (builds `client` first so the extension resolves it, then the web/server/extension bundle with the web UI embedded into `server/public`, then `vscode`) and a `release:ci` script for the workflow.
- 074af64: Fix uploads failing with "No active session" after using the file picker / camera. Opening a native file picker backgrounds the page and fires `visibilitychange: hidden`. If the user took longer than the 8s background-suspend delay (e.g. taking a photo or browsing files), the suspend timer tore down the session, so the upload that ran on return failed. The visibility handler now skips scheduling a suspend while a native file picker is open, and clears that guard when the picker closes (file selected, cancelled, or the page returns to the foreground).
- cf11972: Stop silently losing (or wrongly queueing) a message sent right after returning to a backgrounded/idle tab.

  Two related failures, both rooted in the suspend/resume-on-background path:
  - Lost message: `send()` silently dropped any frame issued on a non-OPEN socket (null / CONNECTING / CLOSING / half-open), so a message typed during the reconnect+resync window rendered locally but never reached the server and was gone after reload. `send()` now reports whether the frame actually went out, and `sendMessage()` checks the real socket `readyState` (via `getIsConnected()`, not the laggy store `connected` flag) and only commits the local echo + clears the error after the frame is confirmed sent; on failure it surfaces a recoverable "not connected, your message was not sent" error, ensures a reconnect is scheduled, and returns `false`. `sendMessage()` now returns a success boolean so the composer only clears the textarea on a real send: a dropped send keeps the typed text intact for retry instead of losing it.
  - Cannot send while disconnected + clear status: the chat composer is now disabled when the socket is not connected (previously only gated on having a session, so you could press send into a dead socket). The placeholder and the existing status line now show "Reconnecting to remote server..." / "Disconnected - cannot send" so the connection state is visible.
  - Wrongly queued, never drained: `isStreaming` could stay stuck `true` across a suspend/resume (the `agent_end` that would clear it arrives on the now-dead socket), so the composer queued the next message as if the agent were still busy, and the queue never drained. `suspend()` now clears the stale `isStreaming` (the authoritative value is re-established by `session_created` on rejoin), `disconnect()` cancels any pending `agent_end` clear timer so it cannot fire against a fresh connection, and the composer only queues when streaming AND connected (and only auto-drains the queue when connected), falling through to a clear error otherwise.

- 605693a: Fix the sidebar getting stuck on "Loading session..." when switching sessions, where the previous session would close but the sidebar stayed open over a hanging spinner and tapping other sessions appeared to do nothing.
  - client: add an atomic `switchSession()` that leaves the current session (if any) and loads the target in a single step. The UI previously did `leaveSession()` then `joinSession()` separated by a 100ms `setTimeout`; that gap could strand the loading state if a tap landed mid-switch or a leave's follow-up load never fired. `switchSession()` always (re)arms the load watchdog for the new target, so a superseded or lost load can never strand the UI and the latest tap always wins.
  - client: shorten the session-load watchdog from 20s to 12s so a genuinely stuck load surfaces a recoverable error (and frees the UI) sooner.
  - web: the sidebar now closes as soon as a load is in flight (loading/resync), not only once the session id is set. A stalled load no longer leaves the sidebar open on top of the spinner.
  - web: the sidebar session click and the URL-hash change handler both use the atomic `switchSession()` path, removing the fragile leave -> setTimeout -> join dance.

- f9080e1: Fix a "Loading session..." spinner that could hang forever, and stop losing a typed message during session resync.

  Stuck loading state (hash auto-join, sidebar selection, and tab-return after >8s):
  - web: only take the resume (preserve-cache, rejoin-in-place) path when a session was actually suspended; otherwise do a plain `connect()` so the hash auto-join drives the load.
  - web: make the hash auto-join self-healing by gating on live state (active session id + loading/resync flags) instead of a latched guard that connect/disconnect churn could strand, and debounce the join via a single tracked timer.
  - client: add a session-load watchdog. The loading/resync flags are set the moment a `session_load` is issued and cleared when `message_history` (or an error/conflict/disconnect) arrives; if none ever comes back (a lost reply, a half-open socket, or any unforeseen edge), the watchdog now clears the flags and surfaces a recoverable error instead of spinning forever. Armed for the sidebar/hash join and the resume-on-reconnect path alike.
  - client: add `hasSuspendedSession()` so callers can choose resume vs. plain connect.

  Lost message draft during resync:
  - web: keep the composer (ChatInput) mounted during reconnect/resync instead of swapping it for a status line, showing a thin "Reconnecting and syncing session..." banner above a disabled input so the in-progress text stays in the live DOM.
  - web: also persist the draft to localStorage and restore it on (re)mount, so the typed message survives even a full unmount or reload. The draft is cleared automatically on a successful send. Drafts are scoped per session, with the no-session search composer getting its own shared draft: switching contexts does not carry text over (the box swaps to the target's own draft, or empties), and returning to a session (or back to search mode by closing the session or hitting the search button) brings its draft back.

- caabb92: Keep the session cached when the tab is backgrounded instead of reloading it on return.

  Previously, backgrounding the tab disconnected and reset the whole client state, so coming back re-fetched and re-rendered the entire session (a visible "reload"). Now the connection is suspended without dropping the cached messages/session: the client records the active session, reconnects preserving the store, and rejoins+resyncs that session in place.

  While reconnecting and resyncing, the composer is replaced by a "Reconnecting and syncing session..." status line so no message can be sent until the socket is back and history has resynced.

  Also fixes the session error banner: long error text now wraps and scrolls within a bounded area instead of pushing the dismiss (X) button off-screen.

- 613f439: Show the app build version next to the "Connected" indicator in the web frontend. Uses SvelteKit's built-in `version` (already wired to the git short hash, with a `-dirty` suffix when the tree has uncommitted changes), rendered right-aligned in a muted monospace style so you can tell at a glance which UI build is loaded.

## 0.4.0

### Minor Changes

- 2b72232: Render assistant chat messages as markdown, and fix two text-selection/copy problems in the chat (most visible on mobile Firefox).
  - **Markdown rendering**: finalized assistant messages now render GFM markdown (headings, lists, bold/italic, links, inline and fenced code, tables, blockquotes) with a dark, compact style scoped to `.markdown-body`. Parsing is done with `marked` and sanitized with `DOMPurify`. Links open in a new tab with `rel="noopener noreferrer"`.
  - **Copy while streaming**: a finalized assistant message is now parsed once and its DOM stays stable, so a text selection inside it survives instead of being collapsed on every token. While a message is still streaming it renders as plain text (no markdown re-parse per token), and only the live, bottom message keeps mutating.
  - **Selection spilling into the chrome**: a drag-select that started in a message bubble and reached the viewport edge could extend into the top bar / sidebar / toggle bar and copy the whole page. The app chrome is now marked non-selectable (`.app-chrome`) and message content is explicitly selectable (`.chat-selectable`), keeping a selection contained to the message.

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

### Patch Changes

- f3c6c43: Add a client-side stale-socket liveness watchdog so a half-open WebSocket to the relay no longer hangs the connected agent forever.

  A half-open TCP connection (peer vanished without a clean FIN/RST: relay restart, network blip, dropped upstream) leaves the socket in `ESTAB` and fires neither `close` nor `error`, so the client's existing reconnect machinery was never triggered and the agent waited on the dead socket indefinitely (recoverable only by restarting the relay). `WhereverClient` now:
  - records `lastInboundAt` on every inbound frame (any frame, including the `pong` reply, counts as proof of life);
  - runs a periodic app-level `{type:'ping'}` keepalive so a healthy connection stays warm even during long, token-less model turns;
  - runs a watchdog that, when the socket has been silent past a threshold (~60s, comfortably above the keepalive interval), forcibly `terminate()`s/`close()`s the dead socket and calls the existing `scheduleReconnect()`.

  This reuses the existing exponential-backoff reconnect logic (the only thing missing was the trigger), so a wedged agent now self-heals in ~60s by reconnecting instead of requiring a manual relay restart. The watchdog timers are torn down on `close`/`disconnect`, and the socket is nulled before `terminate()` so the normal `close` handler does not double-fire a reconnect. Implements Slice A of `work/observations/ws-half-open-connection-hangs-agent-no-heartbeat.md`.

- dff6a44: Move the context-window usage indicator (e.g. `11.3% / 1.0M`) from the top bar to the bottom toggle bar, next to the Hide Thinking / Hide Tools toggles, and let that bar wrap onto a second line on narrow screens so nothing gets squeezed off.
- 94cb06c: Fix session selection showing the "New Session Started" empty state and not scrolling to the bottom while an existing session loads.
  - Added a dedicated `loadingSession` state flag that is set the moment a `session_load` is requested and cleared when its `message_history` (or an error/conflict/disconnect) arrives. This distinguishes "opening an existing session" from "a brand new empty session", so the chat view now shows a "Loading session..." spinner instead of "New Session Started" during the gap between the `session_created` and `message_history` websocket messages.
  - Scroll-to-bottom now also fires on the `loadingSession` true→false edge (when the history actually renders) using a settle loop across a couple of animation frames plus delayed retries, so freshly opened sessions reliably land at the bottom even when tall markdown/code content keeps growing for a few frames after mount.

- 6c036d9: Add a server-side WebSocket heartbeat that reaps dead/half-open relay connections.

  A half-open TCP socket (peer vanished without a clean FIN/RST: process restart, network blip, dropped upstream) stays in `ESTAB` and fires neither `close` nor `error`, so the relay never noticed the dead agent and its session was left dangling forever. The relay now sends a protocol-level ping frame to every connection on a fixed interval (30s) and `terminate()`s any socket that did not answer the previous ping. Because `terminate()` fires `close`, this routes through the existing teardown (`unregisterCliSession` / `removeClient` + `broadcastSessionsUpdated`), so a reaped agent's session is released rather than left hanging. The interval is cleared on `wss` close and on shutdown.

  Pairs with the client-side stale-socket watchdog (Slice A): the server reaps its own view of the dead connection while the client self-heals by reconnecting. Implements Slice B of `work/observations/ws-half-open-connection-hangs-agent-no-heartbeat.md`.

- 9db52f1: Add a `sessions.ignore` config option to exclude session folders from the dashboard list and speed up `/sessions`.

  The session list was built by reading and JSON-parsing **every** session file on disk on every `/sessions` request (to compute each session's first-message preview). With hundreds of sessions, including large piles of throwaway agent scratch sessions (e.g. under `/tmp`), this made the list noticeably slow to load.

  You can now set, in `~/.wherever/config.json`:

  ```json
  { "sessions": { "ignore": ["/tmp/**", "~/.agent-runner/**"] } }
  ```

  Any session whose resolved working directory matches one of these globs is excluded from the list. Crucially, because all sessions in one on-disk folder share a working directory, a matching folder is detected by reading only its first file's header (not its body) and is then **skipped before its file bodies are read**, so ignored sessions no longer cost anything to scan. Globs support `*` (does not cross a path separator), `**` (crosses separators), and `?`; `~` is expanded to home; and a pattern ignores both the directory itself and everything nested under it. When `sessions.ignore` is empty or omitted, behaviour is unchanged (the existing fast path is used).

- e1f9601: Shrink and de-thrash the `/sessions` payload so the dashboard loads fast with many sessions.

  The session list shipped the **entire, untruncated first message** of every session (often huge: pasted prompts, PRDs, specs), even though the sidebar only renders a ~40-char snippet. With hundreds of sessions this made `/sessions` multi-megabyte and slow, and it was refetched aggressively.
  - **Server (shrink):** `listSessions()` now caps `firstMessage` to a short, whitespace-collapsed preview (160 chars) at a single choke point, so every listing path ships a small preview. The field name is unchanged (now documented as a capped preview); the sidebar's display and filtering work as before. Measured against a real ~900-session store, the first-message portion of the payload dropped roughly 33x (multi-MB to ~140 KB).
  - **Web (de-thrash):** `fetchSessions()` no longer runs two fetches at once, collapses any requests arriving while a fetch is in flight into a single trailing re-fetch, and caps its debounce so a continuous stream of `sessions_updated` events (one per agent turn) can no longer pull the whole list repeatedly or postpone the fetch indefinitely.

  This composes with the `sessions.ignore` / `sessions.readOnly` options (which cut how many sessions are scanned/listed at all): together the default session list is now small and quick to load.

- 123b6a3: Add a per-turn transport-stall timeout and liveness observability to the WebSocket relay.

  Builds on the stale-socket watchdog (Slice A) and server heartbeat (Slice B):
  - **Per-turn stall timeout (client).** While a turn is streaming, the watchdog now uses a shorter deadline (`TURN_STALL_MS`, 45s) than the idle stale-socket threshold (60s). The keepalive pong should keep traffic flowing during a turn, so this distinguishes a merely slow model (heartbeat still arriving, not stale) from a dead transport (heartbeat stopped). On a mid-turn stall it surfaces a recoverable `sessionError` ("Connection to relay stalled mid-turn; reconnecting...") and clears `isStreaming` before reconnecting, instead of silently parking mid-stream.
  - **Idempotent re-register on reconnect.** Confirmed already handled: the extension re-sends `cli_register` on every `connected` state edge, which the watchdog reconnect re-triggers, so a vanished-and-returned client re-attaches cleanly.
  - **Observability (pi-remote half).** The client logs stale-socket teardowns, reconnect attempts, and successful reconnects; the server logs each reaped dead socket with its client/session context. A hung agent now shows up as an event rather than as silence.

  Implements Slice C and the pi-remote half of Slice D of `work/observations/ws-half-open-connection-hangs-agent-no-heartbeat.md`. The `agent-runner` wrapper change in Slice D is intentionally left to the agent-runner repo.

## 0.3.0

### Minor Changes

- a0a6adc: Reuse the chat composer as the search composer instead of a separate top-bar input.

  ChatInput is now mode-aware via props (onSubmit, placeholder, submitLabel, showAttach, searchMode, searchConfigured). In search mode it routes submit to the injected handler (runSearch), is enabled with no active session (requires only a live connection and a configured search folder), shows the "Search the web..." placeholder and "Search" button, hides file attach, and skips slash-command handling. The mic, autosize, and Shift+Enter behaviour are kept in both modes.

  On the page the inline single-line top-bar search input is removed. The always-mounted bottom composer becomes the search composer in the empty state (connected, search folder configured, no active session), which is also the page-load state, so users can type directly. When a session is active, a compact magnifier button in the top bar drops back to the search empty state and focuses the composer synchronously inside the tap gesture so the mobile virtual keyboard rises (notably on iOS Safari). Only one search input is ever shown at a time.

  Also fixes a bug where a search query was silently dropped: the client runs app message listeners before its internal state update, so sending the pending query directly from the session_created handler hit sendMessage while sessionId was still null. The query is now deferred to a microtask so the session is fully established first, and the magnifier clears the URL hash synchronously to avoid flashing the "Loading session..." spinner.

- 242b652: Add a web "search mode". A search bar in the dashboard top bar (visible when connected and a search folder is configured, autofocused on first load) creates a fresh session in the configured search folder and sends the query as the first message, returning a current, cited answer. New `searchFolder` and `searchCreateRemote` config keys (in `~/.wherever/config.json`) are exposed via `GET /config`; the search folder is created on demand on first search, with a private remote when `searchCreateRemote` is enabled and a matching remote rule exists. The reusable web-search skill (in `skills/web-search`) drives the same behaviour from the terminal via the companion `pisearch` installer.

### Patch Changes

- 37de34b: Extract core client WebSocket and state management logic into a dedicated, framework-agnostic `@wherever-dev/client` monorepo package. Update both the web dashboard (`@wherever-dev/web`) and the CLI extension (`@wherever-dev/pi`) to use the new shared client, reducing duplicate code and establishing a modular architecture for future integrations.
- ffd28c7: Improve resume behaviour after the page is backgrounded (notably Firefox on Android after a screen lock). The dashboard now closes its WebSocket after the page has been hidden for a short delay and reconnects immediately on return, improving back/forward-cache eligibility (so resume can be instant) and ensuring that, when a full reload does happen, the active session is restored quickly from the URL hash. Quick tab switches do not churn the connection.
- ffd28c7: Fix stale data on first load: the service worker no longer serves cached responses for dynamic server API endpoints (`/sessions`, `/config`, `/models`, `/check-path`, `/autocomplete-path`, `/session/*`, `/health`), which are now fetched online-first. App-shell navigations are also served online-first so a freshly deployed build is picked up without needing a second reload. Hashed assets and images remain cache-first for offline support.
- ffd28c7: Fix: unqueuing a queued message now restores its text into the editable input (so it can be edited or resent) instead of silently discarding it. Previously `Unqueue` cleared the input even though a backup of the message existed.
- 40c88c7: robust againt invalid session file
- ee52ff4: Improve Lighthouse scores for the dashboard PWA.
  - Web: stop shipping un-minified production assets. The Vite build had an
    inherited `minify: false` override which left JS/CSS unminified, roughly
    halving the largest chunk's size and fixing slow First/Largest Contentful
    Paint. Sourcemaps stay enabled for debuggable production stack traces.
  - Server: set `Cache-Control` headers when serving static files. Content-hashed
    `/_app/immutable/` assets are served `public, max-age=31536000, immutable`;
    the HTML app shell, manifest and other top-level files stay `no-cache` so a
    freshly deployed build is always picked up. This fixes the "efficient cache
    lifetimes" audit without affecting the service worker's own caching.
  - Server: add `.txt` and `.webmanifest` MIME types so robots.txt is served as
    `text/plain` and the manifest as `application/manifest+json` instead of
    `application/octet-stream`.
  - Web: add a minimal valid `robots.txt` so the SPA fallback no longer returns
    the HTML app shell for `/robots.txt` (which Lighthouse flagged as invalid).
    Wherever is a private Tailscale-only tool, so it disallows all crawlers.

- affc7cf: PWA: make the installed icon resolve correctly on Firefox Android. Regular icons now carry an explicit `purpose: "any"` (some Firefox versions otherwise fall back to a generated letter icon), and maskable icons are generated at both 192 and 512 (Firefox prefers a maskable at the launcher size). Firefox still overlays its own small badge on installed-PWA icons, which is a browser behaviour and not controllable from the manifest.
- eb0cfd0: PWA polish: the installed app icon is now generated from the Wherever logo (`logo.svg`) instead of the old placeholder, a properly padded `maskable` icon is generated (fixing the previous broken/missing maskable icon reference), and the manifest now declares desktop (`wide`) and mobile screenshots so Chrome offers its richer install UI. Icon/screenshot assets are produced at build time via a post-process step from committed sources under `static/pwa-src/`.
- 7b2ca04: PWA: set the web manifest `display` to `standalone` (was the pwag default `fullscreen`) and give the app a real identity (`name`/`title` "Wherever" with a proper description) instead of the template placeholder. This makes the installed app launch in its own window rather than a normal browser tab on browsers that honor `standalone`.
- 347e214: Removed all architecture overview diagrams and explicit references to "pi CLI" from the website landing page to simplify the landing page experience and remove any installation dependencies on pi or the CLI extension for typical dashboard users.
- a57e137: Rephrased website landing page copy, app description, and user onboarding elements to focus on building and maintaining apps "from wherever" (on any device), shifting the AI component to an implementation detail and correcting references from "mirroring terminal" to "syncing sessions and conversations".
- ffd28c7: Speed up loading of long sessions with tail-first history windowing. On load/join, the server now sends only the most recent messages (with a total count and offset) instead of the entire history in one payload, and the web dashboard shows a "Load older messages" button that lazily fetches earlier windows (with scroll-position anchoring). This adds `history_load_more` / `message_history_prepend` to the protocol and a `loadMoreHistory()` method plus history pagination state to `@wherever-dev/client`.
- fd8427d: Updated documentation and the landing page to clarify that installing the `pi` CLI is optional and not required to run Wherever in Headless Mode. Added notes detailing the architectural limitation where quitting/killing the `pi` CLI in Bridge Mode interrupts active sessions and running tools.

## 0.1.0

### Minor Changes

- 76522ac: Add standalone marketing/info website for GitHub Pages deployment. The new `site/` folder contains a SvelteKit + TailwindCSS static site with a landing page featuring hero section, features grid, architecture diagram, install guide, and footer. Includes a custom SVG logo with a pi symbol made of tetris-like blocks and signal waves. Deployed automatically via GitHub Actions workflow on push to main.

### Patch Changes

- bb36b59: Automatically expand shell/bash command tool calls in the remote web dashboard when the user executes a prompt starting with "!" or "!!".
- 8626cd3: Automatically update the session browser list in the sidebar in real time whenever a session is created, loaded, left, when client connections open or close, and when messages or agent cycles end.
- 26cba7b: Add toggles for hiding tool calls and thinking messages in the chat UI.
- e5fae9d: Maximize available horizontal space in the header for the workspace folder path by displaying the agent status (Ready vs. Agent working) directly on the robot model selector icon, removing the redundant text status indicators.
- e87ab30: Add "Hide thinking steps" and "Hide tool calls" options in the config UI to clean up the chat log. "Hide tool calls" keeps tool execution blocks visible if they are associated with explicit user terminal commands starting with `!` or `!!`.
- bb0bc3d: Normalize `cwd` paths in the server's session pool before creating, loading, or registering sessions. This resolves duplicate session folders when a workspace is accessed with vs. without a trailing slash (e.g. `--home-wighawag...--` vs `--home-wighawag...---`), fragments conversation history, and handles relative segments and double slashes.
- 01e6641: Fix the `/new` / `session_new` command on the server so that it successfully creates a brand new, clean session instead of returning the existing active session when the requesting client is already connected to it.
- 0630cff: Add a full-screen loading overlay on the main screen during session creation. This prevents users from initiating multiple simultaneous session creations and provides visual feedback during the creation delay.
- afe5ebc: Change sessions in the sidebar session browser to standard anchor links, allowing users to middle-click, command-click, or right-click to open sessions in new tabs.
- 70a974a: Configure both `web` and `site` packages for static site pre-rendering by setting `prerender = true` (in page/layout routing) and removing `fallback: 'index.html'` from the svelte static adapter configs. This enables SvelteKit to generate correct, portable relative-path references in the built HTML files, allowing the dashboard and marketing website to load perfectly under subpaths or IPFS gateways.
- ae04a3c: Redesign the remote web dashboard to match the brand design system and colors of the marketing website, introducing brand-dark, brand-surface, brand-border, emerald, and rose theme tokens across all UI components, dialogs, inputs, and layout blocks.

## 0.0.4

### Patch Changes

- 393e8aa: update to port 31415

## 0.0.3

### Patch Changes

- e54e697: Allow users to collapse folders in the session browser even when a filter query is active, with automatic reset of search-specific folder expansions when clearing the search query.
- 948ad33: fix: show full folder path under folder name in session sidebar

  When multiple directories share the same basename (e.g. `/home/user/wighawag`
  and `/home/user/projects/wighawag`), they appeared as separate groups with the
  same visible name, making them indistinguishable. Now the full resolved path is
  shown in smaller gray text beneath the folder name for easy differentiation.

- 14f1269: Show queued message text in input box as greyed-out italic text when agent is streaming

  When a message is queued (sent while agent is working), the text is now visible in the disabled textarea in a grey italic style instead of being hidden. Unqueueing clears the text and re-enables editing. Also added a refresh button (↻) next to the session filter in the sidebar to manually refresh the session list, with a spinning animation while loading.

- d319cfd: Fixed session list issues in the sidebar:
  - Fixed duplicate folder entries by properly resolving path representations (like expanding ~ and relative paths) consistently on the server.
  - Added keyed loops in Svelte `#each` blocks to make session list rendering reactive and prevent unnecessary DOM rebuilds.
  - Debounced `fetchSessions()` calls to coalesce rapid concurrent requests during bulk operations.
  - Added a "Delete All" button inside each folder's expanded session list to delete all sessions of that folder at once.
  - Prevented visual reloading/layout-flashing by keeping the existing list visible during background refreshes, only displaying the loading spinner on initial load when the folder list is empty.

- a697a2d: Ensure model choices are preserved across page reloads, server restarts, and synchronized dynamically between web and CLI.

  Specifically:
  - Fixed an issue where the model resolved to the first (oldest) model_change entry on session reload/restart instead of the most recent one.
  - Added model_select event propagation so that changing the model in a CLI session dynamically updates any connected web client.
  - Added support in the CLI bridge extension to receive and apply model changes initiated from the remote web dashboard.

## 0.0.2

### Patch Changes

- 2b2a81e: Add the ability to send images and documents by uploading them to a configurable server-side folder and appending their absolute paths to the user's message so the agent can read and process them.
- dda50b5: Add hint on the main screen stating that the sidebar can be used to open existing/running sessions.
  - format files

- 4859ae8: remove empty message from the conversation
- 1ae3216: Compress session list folders by default and support inline session deletion with double-confirmation, syncing state instantly across all clients. Fix mobile browser layout issues on Firefox by locking page overscroll and constraining container layout to visual viewport boundaries.
- 696abee: auto-completion path
- 66f8354: common folder
- e890743: Add support for executing bash commands directly from the Svelte web frontend using the `!` prefix (e.g., `!ls`, `!!git status`), matching the pi CLI's interactive behavior.
  - Intercepts prompts starting with `!` or `!!` on the server and runs them through the active AgentSession's executeBash or forwards them as `cli_bash` messages to the CLI bridge client.
  - Streams tool execution chunk updates back to the Svelte client in real-time.
  - Captures output and exit status and persists them to the session log as a `bashExecution` history message.
  - Supports raw output streaming of direct shell command executions.

- ce9aff8: Document all advanced features in the main README and enrich the USAEG guide with HTTP endpoints and WebSocket events.
- 002e622: fix abort on reload
- 49bc222: better side bar
- bf81616: git remote repo creation
- 2a1466a: speech api
- b8acc26: Improve speech recording feedback and reliability:
  - Transition from `MediaRecorder` to direct `AudioContext` / PCM buffer capture for instant, zero-latency WAV creation.
  - Add an audible synthesizer beep / chime on recording start for clear user feedback.
  - Introduce an explicit `isProcessing` state during local downsampling and cloud transcription to replace the red pulsing mic indicator with an orange processing indicator.
- 0a6f84e: remove empty message from the conversation and fix url hash persistence
- 99c1afa: Remove the clear button from the chat list and add a way to collapse the text input bar for easier reading on mobile. Clicking the collapsed bar expands the input and automatically focuses the textarea.
- ba41c2a: better enter keys for send
- 5ba8fd3: add option to upload via normal post request

## 0.0.1

### Patch Changes

- first release
