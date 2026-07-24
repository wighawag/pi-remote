---
"wherever-dev": patch
---

Make `/skill:<name>` work in browser (server-created) sessions, and add composer autocomplete for skill commands.

Previously, `/skill:<name>` only worked when a session was bridged to an external pi CLI process, because the CLI expanded it on its side. For sessions the wherever server runs in-process (the browser path), messages were sent via `AgentSession.sendUserMessage()`, which calls `prompt()` with `expandPromptTemplates: false`, so `/skill:foo` was forwarded to the model verbatim instead of inlining the skill body. Server sessions now route any `/`-prefixed message through `prompt({ expandPromptTemplates: true, source: 'interactive' })`, matching the pi CLI exactly: all expansions (skills, prompt templates, extension commands) are start-of-message anchored, and any trailing text after `/skill:<name> ` is preserved and appended after the skill block. Plain (non-slash) text keeps the existing `sendUserMessage()` path.

Also adds a `/skill:` autocomplete dropdown in the composer. Skills discovered for the active session (including `~/.agents/skills`) are surfaced to the web client via a new `skills_request`/`skills_list` protocol pair (requested on `session_ready`). Typing `/setu` fuzzily matches and offers `/skill:setup`; ArrowUp/Down navigate, and the first Enter/Tab ACCEPTS the highlighted command (inserting `/skill:<name> ` with a trailing space) without sending, so a second Enter is needed to submit. This mirrors the CLI's accept-then-send behaviour and lets the user type an argument after selecting a skill.
