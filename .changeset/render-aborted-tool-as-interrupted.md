---
"wherever-dev": patch
"@wherever-dev/client": patch
---

Render an aborted tool call as interrupted, not a red error.

When you hit the web "abort" button while tools are running, pi kills the in-flight tools and surfaces each as an errored result with a trailing "...aborted" status ("Command aborted" for bash, "Operation aborted" for edit/write). The web then rendered that as a red error tick, as if the tool had genuinely failed. With parallel tool calls this was especially confusing: a tool that happened to finish just before the abort showed a green success tick while the killed one showed a red error, even though the user aborted the whole turn.

The client now detects an abort result (an errored result whose trailing status line is "...aborted") and renders it with the neutral "interrupted" state (muted icon, neutral border) instead of a red error, on both the live tool_end path and when reconstructing from loaded history. A tool that genuinely completed keeps its green success, and a genuine failure keeps its red error. The match is anchored to the trailing status line, so ordinary command output that merely contains the word "aborted" is not misclassified.

Also fixes a related mismatch with PARALLEL same-named tools. Live tool_end frames were matched to a tool message by name via a last-match search, so with two concurrent bash calls both tool_end frames could land on the same message, leaving the other tool stuck streaming; it was then finalized by the agent_end sweep with no result and shown as a bogus green success tick. tool_end now claims the OLDEST still-streaming tool of that name (FIFO), so each concurrent call settles a distinct message. And any tool still streaming when the turn ends (agent_end) is now marked interrupted rather than left to render green, since its outcome is unknown.

Also adds a `tool-calls` (parallel tool_use) behavior to the test fake LLM to exercise concurrent tool execution.
