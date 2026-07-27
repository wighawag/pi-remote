---
"wherever-dev": patch
---

Show messages that are still queued as mid-stream steers after a reload. A message sent while the agent is streaming is queued by pi and injected at the next step, but until then it lives only in the agent's memory: it is not in the session file, so a reloaded client painted history with no trace of it. The text simply disappeared from the UI while the agent still had it and went on to act on it.

Attaching to a session (`session_load`, which also serves reload and reconnect resync) now replies with a `queue_update` snapshot of the current steer queue, and the client re-materializes any queued message its history does not contain, so it renders with the "Queued (not yet sent to the agent)" badge and stays cancellable. When the queued message is finally injected, the server's echo reconciles onto that bubble instead of appending a duplicate.
