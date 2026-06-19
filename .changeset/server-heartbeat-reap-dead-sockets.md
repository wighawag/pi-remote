---
"wherever-dev": patch
---

Add a server-side WebSocket heartbeat that reaps dead/half-open relay connections.

A half-open TCP socket (peer vanished without a clean FIN/RST: process restart, network blip, dropped upstream) stays in `ESTAB` and fires neither `close` nor `error`, so the relay never noticed the dead agent and its session was left dangling forever. The relay now sends a protocol-level ping frame to every connection on a fixed interval (30s) and `terminate()`s any socket that did not answer the previous ping. Because `terminate()` fires `close`, this routes through the existing teardown (`unregisterCliSession` / `removeClient` + `broadcastSessionsUpdated`), so a reaped agent's session is released rather than left hanging. The interval is cleared on `wss` close and on shutdown.

Pairs with the client-side stale-socket watchdog (Slice A): the server reaps its own view of the dead connection while the client self-heals by reconnecting. Implements Slice B of `work/observations/ws-half-open-connection-hangs-agent-no-heartbeat.md`.
