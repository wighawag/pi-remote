---
"wherever-dev": patch
"@wherever-dev/pi": patch
---

Fix Abort being disabled (and the composer enabled) when joining a pi CLI session that is mid-tool-call.

When a session is being driven by the pi CLI and you opened it in the web frontend while a long tool call was in flight, Abort showed disabled and the composer looked ready, even though the CLI was still waiting for the tool to finish. Root cause: the CLI bridge only forwarded `agent_start`/`agent_end` as they happened and registered the session with a hardcoded `isStreaming: false`, so a turn already in progress when the bridge (re)connected was invisible to the server. Now the extension reports the agent's current streaming state (`!ctx.isIdle()`) in the `cli_register` handshake, and the server honors it (and keeps the mid-turn session from being idle-reaped), so a viewer joining a running CLI session correctly sees it as streaming.
