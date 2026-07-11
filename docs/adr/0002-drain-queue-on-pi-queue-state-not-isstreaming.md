# Drain the local message queue on pi's run-idle + empty-server-queue, not on `isStreaming`

**Status:** superseded by [0003](0003-steer-by-default-on-explicit-submit-no-local-auto-drain-queue.md)

> Superseded 2026-07-11. This ADR proposed making mid-stream sends `followUp` and draining the local queue only on run-idle + empty server queue. ADR 0003 takes the opposite, pi-aligned direction: an EXPLICIT user submit steers immediately and there is NO local auto-drain queue at all. This is not a contradiction: the "stops midway" defect was UNINTENTIONAL, auto-fired steering driven by guessing from `isStreaming` (the flaky 300ms `agent_end` debounce), and ADR 0003 removes that auto-fire mechanism entirely. Follow-up survives only as pi's explicit, opt-in Alt+Enter, never the default. See ADR 0003's "Reconciliation" section. The original analysis below is retained for the record.

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
