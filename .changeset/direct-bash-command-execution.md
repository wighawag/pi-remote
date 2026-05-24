---
"pi-remote": patch
"pi-remote-server": patch
---

Add support for executing bash commands directly from the Svelte web frontend using the `!` prefix (e.g., `!ls`, `!!git status`), matching the pi CLI's interactive behavior.

- Intercepts prompts starting with `!` or `!!` on the server and runs them through the active AgentSession's executeBash or forwards them as `cli_bash` messages to the CLI bridge client.
- Streams tool execution chunk updates back to the Svelte client in real-time.
- Captures output and exit status and persists them to the session log as a `bashExecution` history message.
- Supports raw output streaming of direct shell command executions.
