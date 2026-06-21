# Drain the local message queue on pi's run-idle + empty-server-queue, not on `isStreaming`

**Status:** accepted

The "pi stops midway" bug is caused by the frontend draining its local message
queue when `isStreaming` goes false, then delivering the queued message as a
`steer` that redirects the still-running agent. We decided the queue must drain
only when pi's run is idle **and** pi's authoritative server-side queue is empty,
surfaced by **forwarding pi's existing `queue_update` event** to the client (a
new server message), and mid-stream sends must enqueue as `followUp` (a new
request after the loop ends), not `steer`.

This is grounded in pi's actual event semantics (traced in
`pi-agent-core/dist/agent-loop.js`): `agent_start`/`agent_end` wrap the whole
loop; `turn_start`/`turn_end` fire per step and are not "user turn complete";
`agent_end` is emitted at multiple points and the loop re-checks its server-side
queue before continuing. So no single client-observable event means "request
complete," and the client's current 300ms `agent_end` debounce is a heuristic
that any tool slower than 300ms defeats.

**Consequences:** wherever does not invent a turn lifecycle; it forwards pi's
`queue_update` (handled by neither server nor client today) and the client
reducer keys queue-drain off run-idle + empty-server-queue. This also aligns the
local queue with the broader "pi's server-side queue is the source of truth"
direction (`work/ideas/use-pi-server-side-queue-and-recover-on-reload.md`), so
queue visibility/recovery on reload and the stop-midway fix share one mechanism.
Reproduction (currently RED) lives in that idea's sidecar folder
(`queue-mid-turn-steer.test.ts`).
