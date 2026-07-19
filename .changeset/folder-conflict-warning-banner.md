---
"wherever-dev": minor
---

Replace the blocking session take-over / conflict-resolution dialog with a
non-blocking folder-overlap **warning banner**, and drop the take-over and
read-only *choices* entirely.

Previously, loading or starting a session in a folder that already had another
active session popped a modal offering **Take Over** (interrupt the other
client) or **Read-Only** (observe). This had two problems: the modal blocked the
flow, and **Read-Only** was broken for a brand-new session (there was nothing to
observe, so it fell back to the existing session).

Now the server never blocks:

- On a folder conflict it attaches the client to the folder's session as a
  **read-only observer** and flags `folderConflict` on `session_created`.
- The client renders a persistent **warning banner** with a single **Continue
  anyway** button. Clicking it sends the new `folder_conflict_continue` message,
  which lifts read-only for that client so it can send. It does **NOT** abort or
  take over the other session — both run concurrently (changes may conflict).
- After continuing, the banner stays as a passive warning (no button) and
  **disappears automatically** once no other session is active in the folder,
  driven by a new live `folder_conflict` server→client update broadcast on every
  session-set change.
- A `sessions.readOnly`-configured folder stays hard read-only (Continue anyway
  is a no-op there).

Removed the `session_conflict` / `session_resolve_conflict` protocol messages,
`resolveConflict` / `takeOver`-driven UI, and the `SessionConflictDialog`
component. The web frontend and the VS Code sidebar both use the new banner.
