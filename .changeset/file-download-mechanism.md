---
"wherever-dev": minor
---

Add a file download mechanism so agent-produced files (e.g. a generated PDF saved into the work folder) can be pulled down to a phone/browser. New authenticated `GET /session/download?sessionId=..&path=..` endpoint streams the file with `Content-Disposition: attachment`, guarded deny-by-default: a file is served only when its real (symlink-resolved) path is inside an allowed root (always the session cwd and the resolved upload dir, plus `config.downloads.roots`), so `..` traversal and in-tree symlink escapes are rejected. Configurable via a new `downloads` block (`enabled`, `roots`, `maxBytes`).

The download button in the web UI is driven by the tool CALL itself: the client inspects each tool call and, for a small set of file-oriented tools, renders a download button in the tool-card header (building an authenticated URL against the active session). This works identically in CLI-bridge and pure server-side (web-frontend) sessions, since both already stream tool calls to every client, so no side-channel message is needed. `attach_file` is the intended, agent-driven trigger; `read`/`write`/`edit` cards also offer a button opportunistically. The server additionally registers `attach_file` as a `customTool` on its own `createAgentSession()` sessions so the tool exists in web-frontend sessions that have no CLI bridge.
