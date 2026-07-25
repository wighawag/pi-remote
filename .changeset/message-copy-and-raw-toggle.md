---
"wherever-dev": patch
---

Add per-message actions to assistant replies in the web dashboard: a Copy button that copies the message's raw markdown to the clipboard (with a brief "Copied" confirmation and a clipboard fallback for insecure contexts), and a Raw/Rendered toggle that switches an individual message between its rendered markdown and its verbatim markdown source (shown in a monospace block). Both actions are keyed per message id so each toggles independently, and they live in a subtle action bar that reveals on hover/focus so the transcript stays uncluttered. Display-only: the underlying message content is never modified.
