---
"wherever-dev": patch
"@wherever-dev/client": patch
"@wherever-dev/pi": patch
---

Pair reconstructed tool results to their exact tool call by id, not just by tool name.

The server now forwards the tool-call id on both `tool_call` (the id the assistant issued) and `tool_result` (the `toolCallId` it satisfies) history messages, and the web history mapping matches a result to its exact call by that id, falling back to the previous oldest-open-first per-tool-name behaviour only when no id is present (older sessions, or the synthesized `bashExecution` pair).

This fixes mis-pairing when same-named calls interleave with some left dangling: e.g. two `bash` calls issued back-to-back where only the second returns a result. Name-FIFO alone would resolve the first call and leave the second dangling; id matching resolves the correct one and leaves the genuinely-interrupted call marked interrupted, in place.

Tests: a new client test covering id-exact pairing (result resolves call #2 by id, leaving call #1 dangling/interrupted, order preserved).
