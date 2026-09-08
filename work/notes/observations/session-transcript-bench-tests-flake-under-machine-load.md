# The `session-transcript` window tests use the default 5s timeout and flake under machine load

**Spotted:** 2026-09-08, during a full `pnpm --filter ./server test` run while several `nix build` jobs and test servers were running on the same machine.

## What was seen

```
FAIL test/session-transcript.test.ts > readTranscriptWindow > costs the same for a deep "load older" page as for the tail
Error: Test timed out in 5000ms.
```

Re-run in isolation on the same machine immediately afterwards: **passes in 376ms**, and the whole file passes in 1.2s. So it is ~13x inside the limit when the box is quiet, and over it when the box is busy.

## Why it is a signal rather than noise

These are cost/allocation assertions (the module header in `server/src/session-transcript.ts` documents measured numbers, and `server/test/bench/` holds the harnesses). They are the guard on the property that keeps the server from returning to ~1 GB RSS, so they are worth having. But they are also the only tests in the suite relying on the **default 5s** timeout while doing real work: every test in the deployment and drafts suites carries an explicit 60s. A guard that goes red for a reason unrelated to the property it guards teaches people to re-run until green, which is exactly how a real regression gets waved through.

Note the failing assertion is not itself a wall-clock one (it compares memory/read counts between a deep page and the tail); it is vitest's own per-test timeout that fires. So raising the timeout does not weaken what is being asserted.

## Possible responses, not yet decided

- Give the three heavier cases in this file an explicit generous timeout (60s, matching the rest of the suite). Cheapest, and does not change what is asserted.
- Or move the cost/allocation cases out of the default suite into `server/test/bench/`, which is already where the measurement harnesses live, and run them deliberately rather than on every `pnpm test`.

Unverified whether the same applies to the other two `session-transcript` cases that do real work (`stays bounded on a large transcript`, `keeps only the window in memory`); they did not fail in this run but are the same shape.

## Update, same session: it is not just this one file

A second full run on the same loaded machine failed a DIFFERENT file instead:
`test/conversation-search.test.ts > never returns a session hidden by sessions.ignore`. That file passes in 21.6s in isolation. So the pattern is "whichever timing-sensitive test happens to lose the race", not one bad test.

Measured context: 16 CPUs, load average 10-14 while several `nix build` jobs were settling. `server/vitest.config.ts` sets `poolOptions` but no `fileParallelism` / `maxWorkers` limit, so vitest fans the 22 files across ~16 forks, and most of these files spawn REAL server processes (the harness boots the actual binary against a fake LLM). The suite therefore has tens of node processes live at once by design, and the per-test timeouts assume they each get a fair share of CPU.

**On an idle machine the full suite passes: 22 files / 145 tests, 113s.** Both failures reproduced only under load and neither reproduced in isolation.

Honest note on causation: the read-only-config work that was in flight added a 20-test file that spawns ~20 more servers, so it made the suite heavier and the race easier to lose. It did not introduce the fragility (the 5s default timeout on tests doing real work predates it), but it is a reason to bound the concurrency rather than to keep adding server-spawning files and hoping.

So the response list above should gain a third option, probably the best one:

- Cap `fileParallelism` (or `maxWorkers`) in `server/vitest.config.ts` so the number of concurrently booted servers is bounded by something other than the core count. This fixes every file at once, rather than tuning timeouts test by test, and it makes the suite's cost predictable on a CI runner (which has far fewer cores than this machine).

## Related

Not caused by the read-only-config/state-dir work in the sense that the change touches no read path in `session-transcript.ts` or `conversation-search.ts`, and both files pass in isolation and in full runs on an idle machine with that work applied.
