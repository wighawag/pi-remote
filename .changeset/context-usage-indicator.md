---
"wherever-dev": minor
"@wherever-dev/pi": patch
---

Show context-window usage in the session top bar, like the pi CLI (e.g. `11.3% / 1.0M`).

The dashboard now surfaces how much of the model's context window the active session is using, next to the model indicator. It updates live as turns complete and when the model changes.

- **Server-managed sessions:** the server reads usage from pi's `AgentSession.getContextUsage()` and broadcasts a new `context_usage` message after each turn / message / model switch, and includes an initial snapshot on `session_created`.
- **CLI-bridged sessions:** the server cannot run the agent, so the pi extension forwards its `ctx.getContextUsage()` on `agent_end` and model change; the relay caches and broadcasts it the same way.
- **Display:** percentage of the context window used over the humanized window size (`1.0M`, `200K`, ...), matching the pi CLI. Right after compaction (when token count is momentarily unknown) it shows `– / <window>`. The value clears when leaving a session.
