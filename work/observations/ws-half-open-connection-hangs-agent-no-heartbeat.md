---
title: A half-open WebSocket to the relay hangs the connected agent forever — no server-side heartbeat / liveness watchdog detects or reaps the dead connection
slug: ws-half-open-connection-hangs-agent-no-heartbeat
type: observation
status: open
---

# Half-open WebSocket hangs the agent: no heartbeat to detect or reap it

> Captured 2026-06-18 while diagnosing a `drive-backlog` (`agent-runner`) build
> that repeatedly "got stuck". The agent process was alive and connected to the
> relay on `127.0.0.1:31415` but parked in `epoll_wait` with an `ESTAB` socket and
> empty send/recv queues, doing 0% CPU. Sending it a "continue" message did
> nothing. Restarting the pi-remote `server:dev` process unstuck it: the agent's
> dead socket was torn down, the agent re-dialed the NEW listener (fd 23 -> fd 22),
> resumed CPU, and continued the turn. The mechanism below is traced through the
> code, not assumed.

## The problem

The relay speaks WebSocket (`server/src/index.ts`, `WebSocketServer`). When the
TCP connection between an agent (the CLI bridge client) and the relay goes
**half-open** — one side's request is abandoned / the peer vanishes without a
clean FIN or RST (process restart, network blip, an upstream that dropped the
stream) — the OS leaves both ends in `ESTAB` indefinitely. Nothing in the stack
notices:

- The server only tears a session down on `ws.on('close')` / `ws.on('error')`
  (`index.ts` ~line 1009/1019). **Neither event fires for a silently half-open
  socket** — there is no FIN/RST to trigger `close`, and no I/O error to trigger
  `error`. So the dead connection is never reaped.
- There is a `ping`/`pong` message pair, but it is **client-initiated request/reply
  only**: the web/CLI client calls `ping()` (`client/src/client.ts:841`) and the
  server answers `pong` (`index.ts:1136`). The server NEVER proactively pings, and
  **nobody tracks "did the pong come back within N seconds, else `terminate()`".**
  It is a round-trip echo, not a liveness watchdog.
- The `WebSocketServer` is constructed with no heartbeat: `new WebSocketServer({
  noServer: true })` (`index.ts` ~line 932). There is no `setInterval` ping loop,
  no per-socket `isAlive` flag, no `ws.terminate()` on a missed pong.
- The agent (CLI bridge) side likewise has no read-timeout / "silence too long ->
  reconnect" — it waits on the dead socket forever (the observed `epoll_wait`).

Net effect: a single dropped/abandoned request can wedge an agent permanently,
and the ONLY recovery is killing the relay so the OS finally drops the socket and
the client redials. For an unattended `agent-runner` fleet this turns a transient
blip into a hard, silent stall (made worse downstream by `... | tail -40`, which
emits nothing until the wrapped command exits, so the stall looks like a freeze
from the orchestrator's side).

## Would it have happened without pi-remote? (verdict)

Largely NO — this is a relay-specific failure MODE, though the deeper cause is a
missing-timeout pattern that the relay merely makes easy to hit.

- A direct agent->model connection (HTTP/SSE to a provider) typically surfaces a
  socket timeout, a stream-end, or an HTTP error when the peer stalls or drops,
  and most clients have a request/read timeout. The agent gets an ERROR it can
  act on (retry/fail the turn) rather than infinite silence.
- Routed through pi-remote over a long-lived WebSocket with NO heartbeat on either
  end, the same upstream stall becomes an `ESTAB`-but-dead socket that produces no
  event at all. The agent cannot tell "slow" from "dead" and waits forever.

So the relay converted a recoverable transient into an unrecoverable silent hang.
The fix is therefore TWO-sided: fix the relay (heartbeat + reap), AND make the
client defensively safe so it does not DEPEND on the relay being well designed
(see "Make the client safe regardless of the relay" below). The second is the
more important architectural property: the agent should never be wedge-able by a
buggy, restarting, or slow relay.

## Evidence (from the code and the live system — confirmed)

- Live: agent PID parked in `do_epoll_wait`, `ss -tnp` showed
  `ESTAB 127.0.0.1:5xxxx -> 127.0.0.1:31415` with `Recv-Q 0 Send-Q 0`, 0% CPU.
  An ownerless `ESTAB ... Recv-Q 80 -> :31415` was also present (an abandoned
  connection the relay had not reaped).
- Restarting `server:dev` (new listener PID) recovered it: the client opened a
  fresh socket to the new listener and resumed — proving the agent loop was alive
  and only the dead socket was the blocker.
- `server/src/index.ts`: `wss = new WebSocketServer({ noServer: true })`; the only
  teardown paths are `ws.on('close')` and `ws.on('error')`; `case 'ping'` just
  echoes `pong`. No heartbeat interval anywhere (`grep -i ping|pong|isAlive|
  heartbeat|terminate()` across the repo confirms no watchdog).
- `server/src/session-pool.ts`: tracks an `idleTimer` (default 300_000ms) that
  destroys a session on idleness, but idle-timeout is about INACTIVITY, not
  connection LIVENESS — it does not detect a half-open socket on an
  otherwise-"active" (mid-turn) session, which is exactly the hang case.
- `client/src/client.ts`: the client ALREADY has full reconnect machinery —
  `reconnectTimer`, exponential backoff (`reconnectDelay` 2000 -> `maxReconnectDelay`
  15000), `scheduleReconnect()`, and `connect()` re-establishes the socket. But it
  is wired to fire ONLY from `onClose` / `onError` (the `addEventListener`/`on`
  handlers ~lines 138/152). For a half-open socket NEITHER handler ever fires, so
  the otherwise-capable reconnect logic is simply never triggered. The client can
  recover; it just never learns it needs to. (It also has an `agentEndTimeout`
  ~line 375, but that guards a different state, not socket liveness.)

## Proposed fix

Add a real connection-liveness watchdog on BOTH ends. The standard `ws` pattern,
server-driven, is the core of it.

### 1. Server: heartbeat ping + reap dead sockets (primary fix)

In `server/src/index.ts`, give every connection an `isAlive` flag, mark it true on
any pong, and on a fixed interval terminate sockets that did not answer the
previous ping. This uses the protocol-level ping frame (`ws.ping()`), which is
separate from the app-level `{type:'ping'}` message and does not require client
code changes to be *detected* server-side:

```ts
wss.on('connection', (ws) => {
  // ...existing client setup...
  (ws as any).isAlive = true;
  ws.on('pong', () => { (ws as any).isAlive = true; });
  // ...
});

const HEARTBEAT_MS = 30_000;
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if ((ws as any).isAlive === false) {
      ws.terminate(); // fires 'close' -> existing cleanup (unregisterCliSession / removeClient)
      continue;
    }
    (ws as any).isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeat));
```

Because `ws.terminate()` triggers `ws.on('close')`, this routes through the
EXISTING cleanup (`unregisterCliSession` for CLI bridges, `removeClient` for
viewers, then `broadcastSessionsUpdated()`), so a reaped agent's session is
released rather than left dangling. This alone fixes the "relay never notices the
dead agent" half.

### 2. Agent / CLI bridge client: read-timeout -> reconnect (defence in depth)

The relay heartbeat reaps the SERVER's view, but the agent must also stop waiting
on a dead socket and redial. On the CLI bridge client (`client/src/client.ts`,
the `ping()` site), add a watchdog: send an app-level `ping` (or rely on
responding to server ping frames) and if no traffic/pong arrives within a window
(e.g. 2x the server heartbeat, ~60s), `terminate()` the socket and reconnect with
backoff, re-registering the session. This is what makes the agent SELF-HEAL
without a manual relay restart — the recovery we had to do by hand.

### 3. (Optional) surface it so it is observable

When the relay reaps a connection or a client reconnects after a liveness
timeout, log it and broadcast a `session_*` event, so a stalled agent shows up as
an event rather than as silence. Pairs well with dropping `| tail -40` in the
`agent-runner` wrapper (use `| tee run.log | tail -40`) so the orchestrator can
distinguish "working" from "wedged".

## Make the client safe regardless of the relay (the important one)

The relay-side heartbeat above is necessary but not sufficient: the agent must not
be wedge-able by ANY relay misbehaviour (no heartbeat, slow, mid-restart, buggy).
The good news is the client (`client/src/client.ts`) already has everything EXCEPT
the trigger. The minimal, robust hardening is a client-side liveness watchdog that
reuses the existing `scheduleReconnect()`:

1. **Stale-socket watchdog (core).** Record `lastInboundAt` on every `onMessage`
   (any frame counts as life). On an interval, if `Date.now() - lastInboundAt` >
   threshold (e.g. 60s, > the server's 30s heartbeat so a healthy heartbeat keeps
   it fresh), proactively `this.ws.terminate?.()` / `close()` the dead socket and
   call `scheduleReconnect()`. This makes a half-open socket recover in ~60s
   WITHOUT the relay needing to do anything right — the exact manual restart we did
   by hand, automated. This is the single change that removes the dependence on
   "pi-remote being well designed".

2. **Client heartbeat as the keepalive.** Send `{type:'ping'}` (already exists,
   `client.ts:841`) on an interval and/or respond to server ping frames; treat the
   `pong` as inbound traffic that refreshes `lastInboundAt`. Belt-and-braces with
   #1 so the watchdog has a signal even during long model turns that emit no
   tokens.

3. **Per-request / turn timeout.** When a turn is in flight (streaming), if NO
   token/heartbeat arrives within a turn-level deadline, surface a recoverable
   `session_error` ("connection to relay stalled") and reconnect, rather than
   leaving the UI/agent silently parked. Distinguishes "model is slow" (heartbeat
   still flowing) from "transport is dead" (heartbeat stopped).

4. **Idempotent re-register on reconnect.** Ensure reconnect re-attaches to the
   same session cleanly (re-send session join/register) so recovery is seamless
   mid-turn. Verify the takeover/`registerCliSession` path tolerates a client that
   vanished and came back.

Design stance to record: **the transport must be self-healing on the CLIENT, and
liveness must be detected by HEARTBEAT/timeout, never assumed from `close`/`error`
events** — because a half-open TCP connection fires neither. Any future transport
(WS, SSE, raw socket) inherits this rule.

## Why this matters

Without it, any transient TCP half-open between an agent and the relay is an
unrecoverable, silent hang requiring a manual relay restart that disrupts EVERY
session multiplexed through it. With a server heartbeat + client read-timeout, the
dead socket is detected in ~30-60s and the agent self-heals by reconnecting — the
same outcome as the manual restart, automatically and per-connection.

## Scope / suggested slicing

- Slice A: **client stale-socket watchdog -> `scheduleReconnect()`** (the
  "Make the client safe" #1). Highest value: makes the agent self-heal regardless
  of relay quality, and it is tiny — it reuses the existing reconnect machinery,
  the only new code is an interval + `lastInboundAt` timestamp. Do this FIRST.
- Slice B: server-side heartbeat ping + reap dead sockets (server fix #1).
  Self-contained in `index.ts`; `terminate()` routes through existing teardown.
- Slice C: client heartbeat keepalive + per-turn stall timeout -> recoverable
  `session_error` (client #2/#3); idempotent re-register on reconnect (client #4).
- Slice D: observability/logging of reaps, stalls, and reconnects (server #3),
  plus dropping `| tail -40` in the `agent-runner` wrapper for live output.

Note on ordering: Slice A alone removes the hard dependence on the relay being
well designed and would have prevented today's manual restart; B/C/D harden the
relay and improve diagnosis but are not required for the agent to stop hanging.
