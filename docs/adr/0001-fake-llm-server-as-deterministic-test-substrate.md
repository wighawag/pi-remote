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
(each picks a free port). The fake server becomes a maintained test fixture that
must track pi's wire API if pi changes providers. Spike proving this lives in
`work/ideas/use-pi-server-side-queue-and-recover-on-reload/` (harness +
round-trip + cut-midway).
