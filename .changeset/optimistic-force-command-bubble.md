---
"@wherever-dev/client": minor
"wherever-dev": patch
---

Show web `!command` / `!!command` (force command) bash tool calls INSTANTLY again instead of only after a server round-trip. Since the `!sudo` change, `!`-commands no longer add any local user echo — the bash tool-call render (driven by the server's `tool_start`) is the only feedback — so nothing appeared until the full client → server → `tool_start` → client hop completed, making force commands feel laggy.

The client now renders an OPTIMISTIC bash tool bubble the moment a `!`/`!!` command is sent (correct `$ bash command="..."` label, `forceCommand`, live "Elapsed" timer), tagged `optimistic` so it is NOT delivery-tracked (no watchdog/retry banner) and is reconciled — not duplicated — when the server's real `tool_start` arrives (FIFO match on the oldest pending optimistic bubble, so back-to-back `!`-commands line up correctly). `!sudo ...` is intentionally excluded from the optimistic bubble because the server defers it behind a password prompt and only emits `tool_start` once the password arrives. A stuck optimistic bubble (e.g. the turn ends before any `tool_start`) is still finalized as interrupted by the existing agent_end/aborted sweep.
