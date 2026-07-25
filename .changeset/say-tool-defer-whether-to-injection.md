---
"wherever-dev": patch
"@wherever-dev/pi": patch
---

Stop the agent from speaking when conversation mode is OFF: the `say` tool's own text no longer invites it to decide for itself whether a spoken conversation is active. Since the per-turn conversation-mode signal (ADR 0004) became the authoritative "a spoken conversation is active, add a `say` reply" instruction, the tool description's standing "while a spoken conversation is active" condition was a second, unreliable trigger: the agent could infer "active" from a chatty exchange or dictated-sounding text and call `say` with the mode off.

The description, `promptSnippet` and `promptGuidelines` now split the concerns cleanly: the tool text owns HOW (an additive one-or-two-sentence plain-spoken reply on top of, never instead of, the written answer, no code/markdown/lists), while the injected per-turn hint owns WHETHER. `say` is to be called ONLY when the instructions for THIS turn explicitly state that a spoken conversation is active, that instruction is the only signal there is, and absent it `say` is never called. Both copies (`server/src/say-tool.ts` and the `@wherever-dev/pi` extension's `registerTool` block) are updated identically, and `server/test/say-tool.test.ts` now parses the extension source so the twins cannot drift.

This is guidance, not a hard gate (the tool is still registered when the mode is off); behaviour with the mode ON is unchanged.
