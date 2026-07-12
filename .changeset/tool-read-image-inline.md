---
"wherever-dev": patch
"@wherever-dev/client": patch
---

Render `read`-tool image output inline in the web frontend, mirroring the CLI's inline image display.

When the agent uses the builtin `read` tool on an image path, the pi tool result carries an image content block (`{type:'image', data, mimeType}`) alongside the text note. Previously the server's `extractToolResult` kept only text blocks, so the web never saw the image. The server now also pulls image blocks out of the tool result and ships them (base64 + mimeType) on the `tool_end` frame via a new optional `images` field, and reconstructs them from history when a session is reloaded. The client stores them on the `ChatMessage` (`images`), and the web renders each image inline right under the tool header, always visible (not hidden behind the collapse toggle), while the textual arguments/output stay collapsible. Click an image to open it full size. Text-only tools are unaffected.
