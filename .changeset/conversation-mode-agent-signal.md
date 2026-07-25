---
"@wherever-dev/client": patch
"wherever-dev": patch
"@wherever-dev/pi": patch
---

Make conversation mode's spoken reply actually happen: the agent is now TOLD, per turn, that a spoken conversation is active, so it adds a short `say` reply to its written answer instead of staying silent. "Conversation mode is on" only ever lived in the web client, and a dictated message is byte-identical to a typed one, so the agent had no signal and (following the `say` tool's own guidance) defaulted to not speaking, which made the feature inert unless the user nagged it every turn.

The signal is an OPTIONAL `conversationMode` boolean FIELD on the EXISTING `message` WebSocket payload (no new message type, no new chat role; an absent field means false, so older clients keep working). The web app stamps it, on both the send and the resend path, only when the master `conversationMode` AND `speakReplies` knobs are both active. For a turn whose message carried the flag, a `before_agent_start` hook APPENDS one line to the assembled system prompt asking for a short spoken `say` reply in addition to the written answer; the hint is per-turn (the mode can flip mid-session) and ephemeral (it is a system-prompt addition, so the user's message is preserved verbatim, nothing extra renders on web or CLI, and only the resulting `say` call is visible). It is wired for BOTH session types, mirroring the `say` tool's dual registration: an inline pi extension on the server's own agent sessions, and a `pi.on("before_agent_start", ...)` handler in the `@wherever-dev/pi` extension fed by the flag relayed on `cli_message`, so a bridged terminal session driven from a phone speaks too. With conversation mode (or speak-replies) off, no flag is sent, nothing is injected, and behaviour is exactly as before.

The `say` tool description/guidelines (server and extension, in lockstep) no longer tell the agent to stay silent when "the user is typing", which was the instruction fighting the feature; `say` is now framed as an additive short spoken layer for an active spoken conversation.
