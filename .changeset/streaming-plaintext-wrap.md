---
"wherever-dev": patch
---

fix(web): wrap long tokens in still-streaming (plain-text) messages

An assistant message that is still streaming is deliberately rendered as plain text (markdown is only parsed once the message is final, so the DOM stays stable and a selection survives), but that plain-text block had no `overflow-wrap`, unlike the finalized `.markdown-body` view. A single unbreakable token (a long file path, a URL) therefore pushed the rest of its line past the bubble and off-screen on a narrow viewport, so an in-progress reply looked like it was missing words until it finalized and re-rendered wrapped. The streaming block now uses `wrap-anywhere`, matching the finalized rendering; the same guard was added to the user/thinking plain-text bubbles and to skill-invocation args.
