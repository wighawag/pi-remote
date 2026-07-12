---
"wherever-dev": patch
"@wherever-dev/client": patch
"@wherever-dev/pi": patch
---

Fix dangling tool calls being hoisted to the end of the transcript on the web frontend, showing as a phantom "series of aborted tool calls" after the latest reply.

When loaded history contained a tool call with no matching tool result (e.g. an interrupted long-running `bash` that was superseded by a new user turn, then more replies), the web history mapping deferred every unmatched tool call and appended them all AFTER the last mapped message. So dangling calls from the MIDDLE of the conversation piled up below the latest assistant reply, even though the CLI (and the actual transcript) has them inline where they were issued. The reproducing session was a deliberate recoverability test ("Generate a long message..."/"long running tool call using bash sleep" then interrupting it).

The mapping now renders each tool call IN PLACE at its position in the stream: a result-less tool message is emitted when the tool call is seen, and its matching tool result fills it in later (oldest-open-first per tool name, preserving the parallel-call FIFO behaviour). A call that never receives a result stays exactly where it was issued, correctly marked `interrupted` (neutral "no result" state), instead of migrating to the end. On the live streaming tail, only the newest still-open call is kept streaming ("Elapsed" ticking); earlier open calls in the window are interrupted.

Tests: two new client tests covering (1) a mid-conversation dangling call staying in place with the final message still an assistant reply, and (2) multiple dangling calls where only the newest streams on the live tail while earlier ones are interrupted in place. All existing tool abort/interrupted/duration tests still pass.
