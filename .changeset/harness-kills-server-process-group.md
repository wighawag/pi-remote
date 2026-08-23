---
"wherever-dev": patch
---

Stop the test harness leaking a server process per test file. `startHarness()` spawned the server as `pnpm exec tsx ...` and tore it down with `child.kill('SIGTERM')`, but that signal reached only `pnpm`: the real server sat two levels down (`pnpm` -> `tsx/cli.mjs` -> `node`), so it survived teardown and was reparented to init. A full suite run therefore left ~50 MB of orphaned server behind per test file. Run inside the memory-capped `wherever` systemd service, this filled the cgroup with 141 leaked processes holding ~5.5 GB, pinning it at 98% memory pressure and 8.3 GB of swap: the service never OOM-killed (so `Restart=on-failure` never fired) and instead livelocked in permanent reclaim, presenting as a hang indistinguishable from a crash.

The harness now invokes the `tsx` binary directly (no signal-swallowing intermediary), spawns it `detached` so it leads its own process group, and `cleanup()` signals the entire group and awaits the actual exit, escalating `SIGTERM` -> `SIGKILL` if the process is wedged. The group kill matters beyond the removed `pnpm` layer, since `tsx` itself spawns an inner `node` child that a bare `child.kill()` would strand. A `process.on('exit')` backstop reaps any still-live server, covering the abnormal path where a test throws or the runner kills the worker and `cleanup()` never runs.
