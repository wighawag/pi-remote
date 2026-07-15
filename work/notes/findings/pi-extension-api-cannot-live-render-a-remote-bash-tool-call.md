---
title: pi extension API exposes no way to live-render a remote (`!command`) bash tool call in the CLI TUI
type: finding
status: spotted
created: 2026-07-15
source: Read of `@earendil-works/pi-coding-agent@0.80.6` type declarations (`dist/core/extensions/types.d.ts`, `dist/core/agent-session.d.ts`, `dist/core/session-manager.d.ts`, `dist/core/tools/bash.d.ts`) as installed under `node_modules/.pnpm/@earendil-works+pi-coding-agent@0.80.6_ws@8.20.1_zod@4.4.3`, cross-checked against the wherever CLI-bridge extension code (`extension/src/index.ts`).
---

# pi extension API cannot live-render a remote `!command` bash tool call in the CLI TUI

## Summary

When a `!command` / `!!command` (including `!sudo ...`) is sent to a **CLI-bridge** session from the web frontend, the wherever extension runs it in its own process and records the result, but the pi CLI **does not render the bash tool call live**. The user must quit pi and re-enter the session to see it (pi re-reads the persisted transcript on load). This is NOT fixable from the extension with pi `0.80.6`: the extension API exposes no hook to either (a) inject a `!command` into pi's native input pipeline or (b) push a bash-execution entry into the live TUI render. It affects **all** CLI-bridge `!command`s, not just sudo.

## Where this bites (our code)

`extension/src/index.ts`, the `cli_bash` and `cli_bash_sudo` message handlers. Both do the same thing:

1. `spawn` the command themselves (the sudo one rewrites the leading `sudo` to `sudo -S -k -p ''` and feeds the password on stdin).
2. Stream `tool_execution_start` / `tool_execution_update` / `tool_execution_end` back to the **web** via `sendCliEvent(...)` (so the web renders fine).
3. Persist the result locally with `(ctxVal.sessionManager as any).appendMessage(bashMessage)` where `bashMessage.role === "bashExecution"`.

Step 3 writes the entry to the session file but does **not** repaint pi's TUI. So the web shows the tool call live; the CLI shows nothing until reload.

## Why it cannot be fixed from the extension (pi 0.80.6)

The bash tool call that pi renders live for an interactive `!command` is owned entirely by pi's TUI + `AgentSession.executeBash()`. An extension has no equivalent lever:

- **`ExtensionContext`** (`types.d.ts` ~L208), which is what our handler holds (captured from the `session_start` event as `ctxVal`):
  - `sessionManager` is a **`ReadonlySessionManager`**. It offers `appendMessage(...)` (persist only, no repaint).
  - No `executeBash`, no `reload`, no "render this entry now" method.
- **`AgentSession.executeBash(command, onChunk, { operations })`** (`agent-session.d.ts` L530) DOES run + record + live-render, and even accepts custom `operations` (which is exactly how we'd want to inject the sudo password executor). But `AgentSession` is **not** handed to extensions; `ExtensionContext` does not expose it.
- **`ExtensionAPI`** (the `pi` object; `types.d.ts` ~L871+) has:
  - `sendUserMessage(content, ...)` -> delivers to the **agent** and triggers a turn (wrong: a `!command` must NOT go to the LLM).
  - `sendMessage(customMessage, ...)` -> a **custom** message, not a `!bash` input.
  - `exec(command, args, ...)` -> runs a shell command and returns a result, but does **not** render as a bash tool call in the TUI.
  - **No `submitInput` / `runUserBash` / input-injection entry point.** A grep of all `dist/**/*.d.ts` for `submitInput|processInput|runUserBash|submitBash|injectCommand|feedInput` returned nothing.
- **`user_bash` event** (`types.d.ts` ~L605, with `UserBashEventResult { operations?; result? }` ~L771): this is pi's native `!command` interception point, and it is exactly the right shape (an extension can supply `operations` or a full `result`, and pi then runs + renders + records live). BUT it is **reactive only**: pi fires it when *pi itself* receives a `!command` typed in its TUI. An extension cannot *emit* a `user_bash` event to originate a `!command`.
- **`reload()`** exists (`ExtensionCommandContextActions` ~L1201) and would make pi re-read the transcript (showing the entry, same as manual re-entry), but (1) it lives only on the **command** context, not the event/message context our handler runs in, and (2) a full session reload mid-interaction is disruptive, not an incremental live render.

Net: the extension can persist (`appendMessage`) but cannot repaint, and cannot hand execution back to pi to get pi's own render. So live CLI rendering is impossible from the extension at this version.

## Scope / severity

- Cosmetic-but-confusing: the command actually RUNS and its result IS persisted (visible after reload / re-entry, and always visible live on the web). Only the pi TUI's *live* view is stale.
- Applies to every CLI-bridge `!command`, pre-existing; the sudo work merely surfaced it.
- Server-hosted (non-CLI-bridge) sessions are unaffected: the wherever server runs `AgentSession.executeBash` directly, which renders wherever the server's own consumers render.

## What a pi-side fix would look like (for the future issue/PR)

Any ONE of these on pi's side would resolve it and also let us delete our manual `spawn` in favour of pi's own executor:

1. **Preferred - an input-injection API** on `ExtensionAPI`, e.g. `pi.submitUserBash(command: string, opts?: { excludeFromContext?: boolean; operations?: BashOperations }): Promise<BashResult>`. It would route through pi's native `!command` flow (fire `user_bash`, run via the given/default `operations`, render the bash tool call live, and record it). For our sudo case we'd pass the password-feeding `operations` (see `server/src/session-pool.ts` `buildSudoOperations` for the shape) and drop the extension's hand-rolled `spawn` entirely.
2. **Alternatively - expose `executeBash` (or an equivalent live-rendering append) to extensions**, e.g. `ctx.executeBash(command, onChunk, { operations, excludeFromContext })` that both records AND repaints the TUI, mirroring `AgentSession.executeBash`.
3. **Weakest - a render/refresh hook** so that after `sessionManager.appendMessage(bashExecutionMessage)` the extension can ask pi to render the newly appended entry live (an incremental repaint, not a full `reload()`).

Option 1 is cleanest: it keeps execution ownership in pi (consistent rendering, cancellation, truncation, output-file handling) and removes duplicated bash-spawn logic from the wherever extension.

## Repro

1. `./scripts/dev-switch.sh dev` (links the local extension build) and restart the pi CLI session so it loads the extension.
2. Open that same session in the web frontend (a CLI-bridge session).
3. From the web composer run `!whoami` (or `!sudo whoami`).
4. Observe: the web renders the bash tool call live; the pi CLI shows nothing new. Quit and re-open the session in pi -> the tool call/result is now present (loaded from the transcript).

## Refs

- `extension/src/index.ts` - `cli_bash` and `cli_bash_sudo` handlers (`appendMessage` persist path).
- `server/src/session-pool.ts` - `buildSudoOperations` (the `BashOperations` we would hand to a pi injection API).
- pi types (v0.80.6): `dist/core/extensions/types.d.ts` (`ExtensionContext` L208, `ExtensionAPI` ~L871, `UserBashEvent`/`UserBashEventResult` L605/L771, `ExtensionCommandContextActions.reload` ~L1201), `dist/core/agent-session.d.ts` (`executeBash` L530), `dist/core/session-manager.d.ts` (`appendMessage` L212), `dist/core/tools/bash.d.ts` (`BashOperations`).
