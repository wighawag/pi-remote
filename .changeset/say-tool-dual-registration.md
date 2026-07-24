---
"wherever-dev": patch
"@wherever-dev/pi": patch
---

Add a self-contained `say` tool so the agent can emit a SHORT spoken-form reply (in addition to its written answer) that the web UI will later speak aloud and surface while a spoken conversation is active. Mirroring `attach_file`, it validates its `text` argument (error on blank) and returns a normal tool result carrying the text in `details` — no file reads, no bridge, no side channel. It is dual-registered: as a `customTool` on the server session pool's server-created sessions and via `pi.registerTool` in the `@wherever-dev/pi` extension, so behaviour is uniform across session types. The affordance rides the existing `tool_start`/`tool_end` stream — no new WS message type and no new chat role.
