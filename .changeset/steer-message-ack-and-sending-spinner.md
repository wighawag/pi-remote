---
"wherever-dev": patch
---

Fix steer messages wrongly flipping to "Retry", and show a proper in-flight state for pending messages.

A message submitted while the agent is mid-turn is delivered as a steer, which pi only echoes back (as the user message) at the next model call. When the current turn outlasted the client's ~12s confirmation window, that missing echo made the accepted steer flip to a false "Not delivered / Retry" state. The server now emits a `message_ack` frame the moment it hands a message to the agent (both server and CLI-bridge sessions), and the client confirms delivery on that ack instead of waiting for the deferred user echo. `!command` bash is excluded (its tool output is the real feedback).

The web UI now shows a spinner and a dimmed, ringed bubble while a user message is still `sending`, so a message no longer looks fully delivered and then abruptly becomes "Retry"; the failed state also gets a distinct amber ring.
