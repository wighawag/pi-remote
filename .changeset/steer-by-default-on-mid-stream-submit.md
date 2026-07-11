---
"wherever-dev": patch
---

Steer the agent immediately on a mid-stream submit, matching pi's default.

Submitting a message while the agent is streaming now steers it right away (the server injects it at the next tool/step boundary, before the next LLM call) instead of parking it in a local queue that waits for the whole turn to resolve. The primary button is renamed "Queue" -> "Steer" and the surrounding copy is aligned to pi's language ("Agent is working, Steer to interrupt"). The local `queuedText` wait-then-send and the `isStreaming`-driven auto-drain (and the "Unqueue" button) are removed; this also eliminates the "pi stops midway" auto-fire mechanism (see docs/adr/0003). The submit decision is now a pure, unit-tested helper (`web/src/lib/core/compose-send.ts`), and the hard-won safety is preserved: text is kept on a dropped send, per-session drafts persist, and disconnected/resyncing/agent-pending surface clear states instead of silently swallowing a message.
