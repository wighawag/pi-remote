---
title: Decisions taken while building the conversation-mode agent signal
date: 2026-07-25
status: open
relatedSpec: conversation-mode
relatedTask: conversation-mode-agent-signal
---

Durable record of the judgement calls made in `conversation-mode-agent-signal` (linked from the task's done record / PR body), so a reviewer or a later task can ratify or reverse them instead of rediscovering them.

## 1. The `before_agent_start` hook on a SERVER-created session is an INLINE pi extension

The task said "register the handler on the SERVER's agent (`session-pool.ts`)". The pi SDK has no way to attach a `before_agent_start` handler directly to an `AgentSession`: `createAgentSession()` takes `customTools` but no hooks, and `before_agent_start` is only emitted through the session's ExtensionRunner. The SDK-supported route is `DefaultResourceLoader({ ..., extensionFactories: [...] })`, an INLINE extension (`InlineExtension`, loaded unconditionally, no project-trust gate), which is the SAME `pi.on(...)` surface the CLI-bridge extension uses. So `createConversationModeSignal().inlineExtension` is passed into both `new DefaultResourceLoader(...)` calls in `session-pool.ts`, one per session. Alternative considered: mutating `agentSession.agent.state.systemPrompt` before prompting, rejected because pi resets it to the base prompt on every turn (it would be silently clobbered). Touches: both `createAgentSession()` paths in `session-pool.ts`, and any future task adding server-side pi hooks (this is now the precedent for how).

## 2. The hint text is DUPLICATED (server + extension) rather than shared via a package

The acceptance criterion asked for the injected line to be "defined once ... so the two handlers cannot drift". A genuinely single source would need a shared workspace package: the extension already depends on `@wherever-dev/client`, but the SERVER does not, and adding that dependency would (a) change the published `wherever-dev` dependency graph and (b) make `server` tests and `tsc` require `client/dist` to be built first (they run `tsx src/index.ts` directly today). Chosen instead the repo's existing precedent for server/extension lockstep, the `say` tool: two small twin modules (`server/src/conversation-mode-hint.ts`, `extension/src/conversation-mode-hint.ts`) with pointer comments, plus a real DRIFT GUARD: `server/test/conversation-mode-hint.test.ts` imports BOTH modules and asserts identical hint text and identical latch behaviour (and that the extension's `before_agent_start` wiring is present). Touches: anyone editing either hint file, and any future decision to introduce a shared server+extension package (which would supersede this).

## 3. Latch semantics: armed per message (latest wins) and CONSUMED by the turn

`arm(active)` is called for EVERY user message with that message's flag, and the `before_agent_start` handler consumes the arming. Consequence to be aware of: a turn that is NOT started by a flagged message (an auto-retry re-emitting `before_agent_start`, or, in the bridge case, a message typed straight into the terminal pi) gets no hint. Consuming was chosen over leaving it latched precisely because of the bridge case, where the extension cannot otherwise tell a locally-typed message from a relayed one and a stale signal would inject into a terminal-only turn.

## 4. Changeset also bumps `@wherever-dev/client`

The task's prompt mapped `web/` + `client/` + `server/` to `"wherever-dev": patch`. This change edits `client/src/client.ts` (the `sendMessage`/`resendMessage` options), and the repo precedent for a client-package change is to bump it too (see `.changeset/superseded-session-load-no-clobber.md`, which lists `"@wherever-dev/client"` alongside `"wherever-dev"`). The changeset therefore lists `@wherever-dev/client`, `wherever-dev` and `@wherever-dev/pi`, and never `@wherever-dev/web`.

## 5. Stale line noticed in the task's Prompt block (no drift in the body)

The task body puts BOTH session types in scope (acceptance criteria + an explicit "IN SCOPE ... neither deferred" note), but its `## Prompt` block still carries an older `SCOPE:` bullet saying "web-server sessions only for v1; CLI-bridge is a follow-up". The body's acceptance criteria were treated as authoritative and both session types were built. Worth deleting that bullet if the task text is ever reused.
