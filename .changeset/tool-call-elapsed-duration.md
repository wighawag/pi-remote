---
"wherever-dev": patch
"@wherever-dev/client": patch
---

Show how long each tool call has been running, like the pi CLI.

A running tool now shows a live-ticking "Elapsed N.Ns" and, once it finishes, "Took N.Ns" (one decimal, matching the CLI's bash duration format). The client reducer stamps `startedAt` on `tool_start` and `endedAt` on `tool_end` (new `ChatMessage` fields), and freezes a still-running tool's `endedAt` if the turn ends or is aborted without a `tool_end`, so the timer stops instead of counting up forever. The web UI ticks only while a tool is actually running (no per-frame work on an idle session).
