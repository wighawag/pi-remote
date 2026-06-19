---
"wherever-dev": patch
"@wherever-dev/pi": patch
---

Add a per-turn transport-stall timeout and liveness observability to the WebSocket relay.

Builds on the stale-socket watchdog (Slice A) and server heartbeat (Slice B):

- **Per-turn stall timeout (client).** While a turn is streaming, the watchdog now uses a shorter deadline (`TURN_STALL_MS`, 45s) than the idle stale-socket threshold (60s). The keepalive pong should keep traffic flowing during a turn, so this distinguishes a merely slow model (heartbeat still arriving, not stale) from a dead transport (heartbeat stopped). On a mid-turn stall it surfaces a recoverable `sessionError` ("Connection to relay stalled mid-turn; reconnecting...") and clears `isStreaming` before reconnecting, instead of silently parking mid-stream.
- **Idempotent re-register on reconnect.** Confirmed already handled: the extension re-sends `cli_register` on every `connected` state edge, which the watchdog reconnect re-triggers, so a vanished-and-returned client re-attaches cleanly.
- **Observability (pi-remote half).** The client logs stale-socket teardowns, reconnect attempts, and successful reconnects; the server logs each reaped dead socket with its client/session context. A hung agent now shows up as an event rather than as silence.

Implements Slice C and the pi-remote half of Slice D of `work/observations/ws-half-open-connection-hangs-agent-no-heartbeat.md`. The `agent-runner` wrapper change in Slice D is intentionally left to the agent-runner repo.
