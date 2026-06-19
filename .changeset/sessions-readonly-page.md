---
"wherever-dev": minor
"@wherever-dev/pi": patch
---

Add a `sessions.readOnly` config option and a separate, observe-only Read-only sessions page.

Building on `sessions.ignore` (which fully hides + skips folders), `sessions.readOnly` takes the same glob syntax but treats matching folders differently: they are **hidden from the main session list** (and, like `ignore`, skipped before their file bodies are read on the main view, so they do not slow it down), yet remain viewable on a dedicated **Read-only sessions** page reached via a link in the sidebar.

```json
{ "sessions": { "ignore": ["/tmp/**"], "readOnly": ["~/.agent-runner/**"] } }
```

This is aimed at autonomous agent fleets (e.g. `agent-runner` working directories) you want to watch but not drive:

- `GET /sessions?view=readonly` returns only the read-only folders, each tagged `readOnly`.
- The Read-only page reuses the session browser but hides the create form and all delete controls.
- Opening a read-only session is **forced read-only end-to-end**: the server sets the client read-only (so `message` sends are refused) and reports it in `session_created`; the dashboard then hides the composer entirely, showing an "observing only" notice.

When `sessions.readOnly` is empty or omitted, behaviour is unchanged.
