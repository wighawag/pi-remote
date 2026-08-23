# Use a fake LLM server (not a code-level mock) as the deterministic test substrate

**Status:** accepted

Wherever's recurring bugs live in the protocol / session-lifecycle / transport
layers, and there were zero tests because the agent turn was not injectable. We
decided to test against a **fake LLM HTTP server** that speaks the real
Anthropic-Messages SSE API, selected by pointing an isolated `PI_CODING_AGENT_DIR`
`models.json` provider's `baseUrl` at it, so the **real** `createAgentSession`
and the real `pi` harness run unchanged and talk to it over real HTTP believing
it is a model.

We chose this over a code-level mock of the agent because a code seam can only
fake a *reply*; only a fake server can deterministically reproduce the
transport- and timing-level failures that actually erode our confidence
(mid-stream truncation, slow tool steps, malformed tool calls, 5xx, retries).
It also requires **no production server code change** to wire up, and exercises
the real SSE parser, retry logic, and event broadcasting end-to-end.

**Consequences:** tests are deterministic, free, and offline; the acceptance gate
(`build && vitest && playwright`) can run in parallel across isolated worktrees
(each picks a free port).

Because the substrate boots a **real server process per test file**, harness
teardown is load-bearing rather than housekeeping: a server that survives its
test is a ~50 MB leak multiplied by the file count. The harness therefore runs
`tsx` directly (no `pnpm exec` intermediary, which does not forward signals to
its grandchildren), spawns the server `detached` so it leads its own process
group, and `cleanup()` signals the whole group and then *waits* for the exit,
escalating `SIGTERM` -> `SIGKILL`. A process-level backstop kills any still-live
server on runner exit, covering the crashed-worker path where `cleanup()` never
runs. Regression that motivated this: a suite run inside the memory-capped
`wherever` systemd service leaked 141 server processes holding ~5.5 GB, which
throttled the service into a livelock that looked exactly like a crash. The fake server becomes a maintained test fixture that
must track pi's wire API if pi changes providers. Spike proving this lives in
`work/ideas/use-pi-server-side-queue-and-recover-on-reload/` (harness +
round-trip + cut-midway).
