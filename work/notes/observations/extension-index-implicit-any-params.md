# extension/src/index.ts has pre-existing implicit-any params

2026-07-24 — While drift-checking `attach_file` for the `say` tool task, noticed `extension/src/index.ts` reports pre-existing `TS7006` implicit-`any` errors under `tsc --noEmit` (params `s`, `msg` near the CLI-event forwarding fns, ~lines 584/594/829 pre-change) plus a `TS2307` for `@wherever-dev/client` when the `client` package hasn't been built yet. These exist on the untouched baseline (verified by stashing my change) and are outside this task's scope — noting so the signal isn't lost.
