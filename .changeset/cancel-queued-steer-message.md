---
"wherever-dev": patch
---

Add a way to cancel queued steer messages on the web frontend.

A message sent while the agent is mid-turn is queued by pi as a steer (injected at the next step boundary). Until now the web had no way to retract one: the only option was the Abort button, which kills the whole in-flight turn. The server now relays pi's steer queue to the client (a `queue_update` frame sourced from pi's `queue_update` event). Each still-queued steer bubble shows a passive "Queued (not yet sent to the agent)" badge so you can see which messages are pending, and a single session-level "Cancel queued" button (next to Abort) clears them via pi's `clearQueue()` without aborting the running turn. The cancel action is session-level, not per-message, because `clearQueue()` drops the whole steer queue at once; the button shows a count when more than one steer is queued.

Only server-type sessions report a steer queue, so the affordance never appears for CLI-bridge sessions (the extension API has no per-steer dequeue), where it degrades gracefully to a no-op.
