---
"wherever-dev": patch
"@wherever-dev/pi": patch
---

Show the context-window usage indicator ("11.3% / 1.0M") for CLI-controlled sessions as soon as a viewer joins, instead of leaving it blank until the next turn. Previously the pi extension only forwarded its context usage on `agent_end` and model switches, so an idle CLI-bridged session (no new turn since the bridge connected) had no usage snapshot to show, and the server broadcast `session_created` on `cli_register` without one. The extension now pushes a context-usage snapshot immediately after registering (on connect/reconnect), and the server includes any cached usage in the `session_created` message it broadcasts to web viewers on `cli_register`. Both are best-effort: when usage is genuinely unknown (no model or no turn yet) nothing is shown, matching the previous behavior.
