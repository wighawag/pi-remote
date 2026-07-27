---
"@wherever-dev/pi": patch
---

Bridged terminal sessions get the same conversation-mode tail reminder as server-created ones. The extension already appended the spoken-conversation hint to the system prompt for a turn whose relayed message carried the flag; it now also adds the short reminder at the tail of the messages via pi's `context` event, before every provider call of that turn (including the synthesis call after a tool result, where a system-prompt-only hint measurably stops working), and closes the turn on `agent_end`. The reminder is ephemeral (the SDK applies it to a clone on the way to the provider, so it never lands in the session file or the TUI), role-safe (it rides inside the tail `user`/`toolResult` message rather than opening a second consecutive user turn), and stops as soon as the agent has actually called `say` in that turn, so it can neither nag nor drive a `say` loop. Kept in lockstep with the server twin by the existing drift-guard test.
