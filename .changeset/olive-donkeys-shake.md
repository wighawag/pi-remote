---
'wherever-dev': minor
---

Add saved drafts: keep a message instead of sending it, then load it back later from any device.

The composer footer gains "💾 Save draft" (keeps the typed message and clears the box, the way a send would) and "🗂 Drafts (N)", which opens a list of saved drafts, newest first, with a one-line preview, when it was saved and the folder it was written in. Tapping one loads it into the message box; 🗑 deletes it.

**Drafts live on the server**, not in the browser: `~/.wherever/drafts.json`, behind the same token gate as the other API routes, via new `GET /drafts`, `POST /drafts` and `POST /drafts/delete` endpoints. A draft saved on a phone is therefore there on the laptop, and survives clearing site data or restarting the server. The server is the only writer (it owns ids, dedupe, cap and ordering, and answers every mutation with the whole new list); the browser keeps a mirror only so the list still renders while disconnected. Saving fails loudly rather than silently, and the message stays in the box.

**Drafts work in every composer mode**, including the no-session home page, which is exactly where you want to pull up something written yesterday and fire it into a new session. They are global rather than per session, for the same reason.

**Loading a draft never destroys unsent text:** if the box is not empty the list warns first and offers Replace, Append below (keeps both, separated by a blank line) or Cancel. **Loading does not delete the draft, but sending it does** (mail-client semantics): a mistap must not lose the text, while a message that has actually been sent is no longer a draft. The draft is only consumed when the sent message is still exactly it, optionally below text you typed; edit it further and the draft is kept.

The store fails safe throughout: over-long input is rejected rather than truncated, an unreadable or corrupt `drafts.json` is reported instead of being treated as "you have no drafts" (so a save can never overwrite a file it could not read), writes are atomic and 0600, and the composer is only cleared once the server confirms it has the text.

This is separate from the existing per-session auto-draft, which remains client-side crash protection for the text currently in the box.
