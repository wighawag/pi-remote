---
"@wherever-dev/pi": minor
---

Register a self-contained `attach_file` tool in the CLI-bridge extension (shipped inside the same `@wherever-dev/pi` extension, nothing extra to install). The agent calls `attach_file({ path })` to offer a file for download; the tool only validates the path and returns a normal tool result carrying it, with no dependency on the bridge and without reading the file bytes. The download button is then driven by the tool call reaching the web UI, which is why the same tool works in a pure server-side session too. The prompt directs the agent to attach not only after producing a deliverable (a PDF, an export, a report) but also whenever the user asks for a file by name or type, including one created earlier in the conversation ("give me the gpx", "send me the pdf"), since the remote user can only obtain a file the agent attaches, so a bare file path in a reply is never enough.
