# Evidence: spike artifacts for the "stop midway" + fake-LLM-gate findings

These are **throwaway spike files**, kept as captured evidence for the ideas in
`work/ideas/`. They are deliberately NOT wired into any package's build or test
script, so they do not entangle the working tree. They become real tests only if
and when the rewrite adopts them (move them into `client/test/` / `server/test/`
and add a `vitest` devDep + `"test"` script per package).

## Files

- **`queue-mid-turn-steer.test.ts`** — a RED test against the real
  `@wherever-dev/client` reducer proving the "pi stops midway" mechanism: a
  multi-step turn's intermediate `agent_end` debounces `isStreaming` to false in
  300ms, so a tool step slower than 300ms flips `isStreaming` false mid-turn, the
  frontend queue auto-sends, and the server delivers it as `steer`. Today the
  "stays streaming across a >300ms gap" assertion FAILS (that is the point).
  Evidence for: `../use-pi-server-side-queue-and-recover-on-reload.md`
  (section "THIRD, DISTINCT MECHANISM").

- **`fake-llm-server.ts`** — a fake Anthropic-Messages SSE server. The real pi
  harness talks to it believing it is a model. Supports a deterministic reply and
  a `cut-midway` mode (destroys the SSE socket mid-stream) to reproduce
  transport-level truncation.

- **`harness.ts`** — boots the REAL wherever server against the fake LLM in full
  isolation (throwaway `PI_CODING_AGENT_DIR` with a `models.json` provider
  pointing at the fake; throwaway cwd; HTTP, ephemeral port). Includes a tiny WS
  `TestClient`. This is the deterministic, free, offline gate substrate.

- **`round-trip.test.ts`** — two passing tests through the real stack: a
  deterministic streamed reply, and the mid-stream-cut reproduction.
  Evidence for the dorfl gate viability (`docs/` rewrite brief).

## How to run (ad hoc, from the repo root)

These need the repo deps installed (`pnpm install`) and Playwright not required
(these are vitest-level). They are NOT picked up by `pnpm -r test` by design.

```bash
# client reducer test (the RED one):
pnpm --filter ./client exec vitest run work/ideas/use-pi-server-side-queue-and-recover-on-reload/queue-mid-turn-steer.test.ts

# fake-LLM round-trip through the real server:
pnpm --filter ./server exec vitest run work/ideas/use-pi-server-side-queue-and-recover-on-reload/round-trip.test.ts
```

(If a package has no `vitest` devDep yet, add it temporarily: it was reverted to
keep the tree clean. The rewrite brief covers wiring these in for real.)
