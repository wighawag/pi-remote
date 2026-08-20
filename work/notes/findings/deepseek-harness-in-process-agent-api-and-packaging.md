---
title: DeepSeek Harness (dsh) exposes a usable in-process agent API, but its npm packaging is hostile to external consumers
slug: deepseek-harness-in-process-agent-api-and-packaging
source: 'Live probe run 2026-08-16 against @deepseek-ai/* @ 0.1.0-rc.6 (npm `next` tag) + @deepseek-ai/cordis@4.0.1, kept at tmp/dsh-probe/ (gitignored); cross-read against upstream docs at github.com/deepseek-ai/deepseek-harness @ master (packages/core/agent/README.md, packages/sdk/*/README.md, packages/llm/llm-pi-ai/README.md, apps/cli/README.md, examples/jsonrpc-agent/cordis.yml) and the npm registry metadata as of 2026-08-16'
---

# DeepSeek Harness (dsh) in-process agent API and packaging

## Summary

DeepSeek Harness ships three consumer surfaces: a one-shot CLI (`dsh --profile headless "job"`), subprocess SDKs (Python `deepseek-harness-sdk`, TypeScript `@deepseek-ai/dsh-sdk-client`, both stdio JSON-RPC), and an undocumented-for-integrators but fully functional **in-process** API. The in-process API is the only one comparable to what wherever does with `createAgentSession()`, and it works: 17 lines of plugin wiring reach a live, drivable agent in 38ms. The obstacles are packaging and diagnosability, not the programming model.

This is external ground truth about a system wherever might integrate with. It records no decision. If wherever ever adopts a second agent backend, the decision belongs in `docs/adr/`.

## The in-process API

There is no `createAgentSession()` equivalent. Agent creation is a Cordis service method, `ctx.agents` from `@deepseek-ai/dsh-agent`:

```
ctx.agents.create(options): Promise<AgentHandle>   // AgentHandle = { agent, dispose() }
ctx.agents.resume({ resumeSessionId }): Promise<AgentHandle>
ctx.agents.get(id) / .list() / .roots()
```

`ctx.agents.create()` throws unless the concrete loop plugin (`@deepseek-ai/dsh-agent-loop`) registered itself as the factory. Everything wherever passes as a constructor argument to `createAgentSession()` (authStorage, modelRegistry, sessionManager, settingsManager, resourceLoader, customTools) is instead a plugin composed into a Cordis context.

The `Agent` handle covers wherever's session verbs directly: `followup(msg)` (prompt), `steer(msg)`, `inject(msg)` (queue model-facing context without waking the driver), `cancel(cause, { keepInbox? })`, `whenIdle()`, `status` (`idle` / `running`), `session` (durable log), `inbox`, and `ctx` (the agent-scoped context).

Two capabilities are strictly better than the pi SDK as used at `server/src/session-pool.ts`:

1. **Per-agent scoped registration.** `CreateAgentOptions.setup(agentCtx)` runs after the agent scope is minted but BEFORE the session and agent are published, so tools and listeners registered there exist before `agent/created`, `agent/session-start`, and the first prompt assembly. Registrations unwind on disposal. This is the capability whose absence in pi forced the inline-extension workaround recorded in `docs/adr/0004`.
2. **`cancel(cause, { keepInbox: true })`** aborts the active turn while preserving queued and steering inbox items. pi's `clearQueue()` drops the whole pending queue (the constraint behind `docs/adr/0003`).

`defineTool` (from `@deepseek-ai/dsh-tools`) is a stricter contract than pi's `ToolDefinition`: a canonical `output.schema` is mandatory, and rendering is a separate pure `(args, value) => ContentBlock[]`, so the durable value and its model-facing presentation cannot drift.

## Model providers: not DeepSeek-only, and it is pi-ai underneath

Only two LLM adapters exist. `@deepseek-ai/dsh-llm-deepseek` targets DeepSeek's OpenAI-compatible endpoint (`DEEPSEEK_BASE_URL` can point at any compatible proxy). The general one is **`@deepseek-ai/dsh-llm-pi-ai`, which depends on `@earendil-works/pi-ai` (`^0.82.1`)**, the same library family wherever already ships (pinned to pi-ai via `@earendil-works/pi-coding-agent@0.80.6`).

Consequences worth knowing:

- Any provider in pi-ai's installed catalog (openai, anthropic, google, deepseek, ...) is available by configuration, not code. A route naming an installed provider inherits endpoint, wire protocol, and model catalog, and overrides them field by field.
- A route pi-ai does NOT ship can be declared outright (`api: openai-completions` plus `baseURL` and a hand-written `models` list), so an OpenAI-compatible gateway or self-hosted server is configuration.
- Credentials are declared as **references** (`apiKeyEnv: OPENAI_API_KEY`) resolved per request, so no secret enters the config file. A configured reference that resolves to nothing fails with `MISSING_CREDENTIAL` rather than silently falling through to an unrelated ambient key.
- The adapter can mount **dormant** (zero routes) and gain routes later from the `llm-pi-ai:` settings section.
- So model-routing knowledge transfers 1:1 from wherever's existing pi-ai usage, and probing dsh does NOT require a DeepSeek key.

## Packaging obstacles (all reproduced, 2026-08-16)

1. **The `latest` dist-tag is broken for at least one package.** `@deepseek-ai/dsh-agent-spine-demo@latest` resolves to `0.0.1-rc.1`, which peer-depends on `@deepseek-ai/dsh-paths`. That package was renamed `dsh-home-paths` and the old name is not published, so a plain install dies with `ERR_PNPM_FETCH_404`. The self-consistent set is under the `next` tag (`0.1.0-rc.6`). Several packages carry `latest` and `next` pointing at different major-ish lines.
2. **Every inter-package dependency is a `peerDependency`.** Nothing is installed transitively. Reaching a working agent required materialising a **50-package peer closure** by hand (script kept at `tmp/dsh-probe/resolve-closure.mjs`); the installed tree is 52 packages and 85MB.
3. **Two incompatible plugin conventions.** Some packages export `apply` (namespace-as-plugin: `dsh-agent-spine-demo`, `dsh-llm-deepseek`, `dsh-tool-fs`), others a `default` Service class (`dsh-subprocess-local`, `dsh-bash-local`, `dsh-fs-local`, `dsh-session-persistence-jsonl`). dsh's own Loader unwraps this; a direct consumer needs its own `asPlugin()` helper or gets `invalid plugin, expect function or object with an "apply" method`. `packages/sdk/README` and a linked postmortem confirm the split is deliberate (Loader default-unwrapping would discard a plugin's `Config` schema).
4. **Native postinstall scripts are load-bearing.** `node-pty`, `koffi`, and `dsh-subprocess-local` all run postinstall. Under pnpm's default build-script blocking the process dies at import time with `Failed to load native module: pty.node`, far from the real cause.
5. **Unmet plugin dependencies hang silently.** `@deepseek-ai/dsh-bash-local` was mounted but its service never appeared on the context. Cordis resolves load order from `inject` and simply waits, so a missing peer plugin is not an error, it is a service that never materialises and a capability that is silently absent. This is the sharpest operational hazard for anyone composing a tree by hand.

## Wire-protocol limits that do NOT apply in-process

The subprocess SDKs document "no mid-turn cancel" (abandoning a turn means closing the runtime) and a `run()` whose `finalResponse` is explicitly not causally assigned to the prompt. Both are limits of the JSON-RPC wire, not of the harness. In-process, `agent.cancel()` and per-turn inbox accounting are available. Do not generalise the SDK README's limitations to the embedded API.

## Not established

- **Session persist and resume round trip.** A zero-turn session flushed nothing to the JSONL persistence root, so `ctx.agents.resume()` failed with `session "<id>" not found`. Whether persistence behaves after a real turn, and what the on-disk shape is, is untested. This is the gap that matters most for wherever, which reads pi's `.jsonl` directly and depends on the `parentSession` header for the fork tree (`CONTEXT.md:148`, `:194`).
- Anything downstream of the first model request: streaming events, tool execution, compaction, subagents.
- Closing both gaps needs only an existing OpenAI/Anthropic/Google key via `dsh-llm-pi-ai`, not a DeepSeek key.

## Reproduction

`tmp/dsh-probe/` (gitignored, throwaway): `probe.mjs` composes the tree and creates an agent, `resolve-closure.mjs` resolves the peer closure, `FINDINGS.md` is the raw run log commentary. Nothing outside that directory was touched.
