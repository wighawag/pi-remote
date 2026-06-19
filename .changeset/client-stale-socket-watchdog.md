---
"wherever-dev": patch
"@wherever-dev/pi": patch
---

Add a client-side stale-socket liveness watchdog so a half-open WebSocket to the relay no longer hangs the connected agent forever.

A half-open TCP connection (peer vanished without a clean FIN/RST: relay restart, network blip, dropped upstream) leaves the socket in `ESTAB` and fires neither `close` nor `error`, so the client's existing reconnect machinery was never triggered and the agent waited on the dead socket indefinitely (recoverable only by restarting the relay). `WhereverClient` now:

- records `lastInboundAt` on every inbound frame (any frame, including the `pong` reply, counts as proof of life);
- runs a periodic app-level `{type:'ping'}` keepalive so a healthy connection stays warm even during long, token-less model turns;
- runs a watchdog that, when the socket has been silent past a threshold (~60s, comfortably above the keepalive interval), forcibly `terminate()`s/`close()`s the dead socket and calls the existing `scheduleReconnect()`.

This reuses the existing exponential-backoff reconnect logic (the only thing missing was the trigger), so a wedged agent now self-heals in ~60s by reconnecting instead of requiring a manual relay restart. The watchdog timers are torn down on `close`/`disconnect`, and the socket is nulled before `terminate()` so the normal `close` handler does not double-fire a reconnect. Implements Slice A of `work/observations/ws-half-open-connection-hangs-agent-no-heartbeat.md`.
