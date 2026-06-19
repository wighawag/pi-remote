---
"wherever-dev": minor
---

Render assistant chat messages as markdown, and fix two text-selection/copy problems in the chat (most visible on mobile Firefox).

- **Markdown rendering**: finalized assistant messages now render GFM markdown (headings, lists, bold/italic, links, inline and fenced code, tables, blockquotes) with a dark, compact style scoped to `.markdown-body`. Parsing is done with `marked` and sanitized with `DOMPurify`. Links open in a new tab with `rel="noopener noreferrer"`.

- **Copy while streaming**: a finalized assistant message is now parsed once and its DOM stays stable, so a text selection inside it survives instead of being collapsed on every token. While a message is still streaming it renders as plain text (no markdown re-parse per token), and only the live, bottom message keeps mutating.

- **Selection spilling into the chrome**: a drag-select that started in a message bubble and reached the viewport edge could extend into the top bar / sidebar / toggle bar and copy the whole page. The app chrome is now marked non-selectable (`.app-chrome`) and message content is explicitly selectable (`.chat-selectable`), keeping a selection contained to the message.
