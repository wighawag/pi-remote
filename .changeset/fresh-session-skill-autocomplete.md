---
"wherever-dev": patch
---

Fix `/skill:` composer autocomplete being empty on a freshly created session. The client only asked the server for the session's skill commands (`skills_request`) when it received `session_ready`, but `session_ready` is only sent by the session-LOAD path (it signals "the cold agent finished building"). A brand-new session created via `session_new` is live the moment `session_created` arrives and never emits `session_ready`, so the request was never sent and `state.skills` stayed `[]`: typing `/` in a fresh session showed no menu, while the same session offered the full list after a reload.

The client now sends `skills_request` as soon as the agent is known to be live: on `session_created` when `pending !== true` (fresh create, and warm attach), and still on `session_ready` for a cold load that was `pending`. Re-requesting is harmless since the server always replies with the full list, and the per-session reset of `skills` on attach is unchanged, so switching sessions cannot leak another session's commands. Covered by `client/test/skills-autocomplete.test.ts`.
