# Conversation-mode agent signal: an inline pi extension for the server-side `before_agent_start` hook, and a lockstep-guarded hint twin

**Status:** accepted

Conversation mode's spoken reply was inert because the agent had no signal that the mode was active (client-only state), so it never called `say` (see `work/notes/observations/say-tool-not-invoked-agent-cannot-see-conversation-mode.md`). The fix (`conversation-mode-agent-signal`) rides an optional `conversationMode` boolean on the EXISTING `message` WS payload (no new message type) and turns it into agent-visible context by APPENDING one line to the assembled system prompt for that turn, via the pi `before_agent_start` hook, in BOTH session types. This ADR records the load-bearing judgement calls made while building it.

## 1. The server-side `before_agent_start` hook is an INLINE pi extension (the precedent for future server-side hooks)

The pi SDK has no way to attach a `before_agent_start` handler directly to an `AgentSession`: `createAgentSession()` takes `customTools` but no hooks, and `before_agent_start` is only emitted through the session's ExtensionRunner. The SDK-supported route is `new DefaultResourceLoader({ ..., extensionFactories: [inlineExtension] })`, an `InlineExtension` (loaded unconditionally, no project-trust gate) exposing the SAME `pi.on(...)` surface the CLI-bridge extension uses. So `createConversationModeSignal().inlineExtension` is passed into both `createAgentSession()` paths in `session-pool.ts`.

Alternative considered and rejected: mutating `agentSession.agent.state.systemPrompt` before prompting. Rejected because pi resets it to the base prompt on every turn, so the mutation would be silently clobbered.

This is now the PRECEDENT for how any future task adds a server-side pi hook (before/after provider request, turn hooks, etc.): an inline extension via `extensionFactories`, not a direct `AgentSession` mutation.

## 2. Append to `event.systemPrompt`, never replace, never re-fetch

The `before_agent_start` event carries the fully-assembled `systemPrompt`, and its result `{ systemPrompt }` REPLACES the prompt for the turn. The handler therefore reads `event.systemPrompt` (the value the event carries, which may already include another extension's change, since the SDK CHAINS results) and returns `base + "\n\n" + hint`. It never captures a snapshot and never re-fetches the base, so it composes safely with other extensions.

## 3. The hint is armed per message (latest wins) and CONSUMED by the turn

`arm(active)` is called for EVERY user message with that message's flag; the `before_agent_start` handler consumes the arming (one turn only). Consuming (rather than leaving it latched) was chosen because of the bridge case: the extension cannot otherwise distinguish a locally-typed terminal message from a relayed one, and a stale latched signal would inject into a terminal-only turn.

KNOWN EDGE (see the follow-up observation): a mid-stream steer/followUp message, or a slash/extension command that returns early, arms the latch but never triggers `before_agent_start`, so the arming can survive to a later turn. Worst case is one stray `say` or a hint arriving one turn late. Deferred, not fixed in this change.

## 4. The hint text is DUPLICATED (server + extension twins) with a drift-guard test, not shared via a package

The acceptance criterion asked for the injected line "defined once ... so the two handlers cannot drift". A genuinely single source would need a shared workspace package: the extension depends on `@wherever-dev/client` but the SERVER does not, and adding that dependency would change the published `wherever-dev` dependency graph AND make `server` tests / `tsc` require `client/dist` built first (they run `tsx src/index.ts` directly today). Instead we follow the repo's existing server/extension lockstep precedent (the `say` tool): twin modules `server/src/conversation-mode-hint.ts` + `extension/src/conversation-mode-hint.ts` with pointer comments, PLUS a real drift guard, `server/test/conversation-mode-hint.test.ts`, which imports BOTH modules and asserts identical hint text and latch behaviour. A future decision to introduce a shared server+extension package would supersede this.

## 5. `conversationMode` on the wire means master-AND-`speakReplies`, not the master knob alone

The web client stamps the payload flag via `shouldSignalConversationMode` = `isKnobActive('speakReplies', knobs)`, i.e. master `conversationMode` AND `speakReplies` (a "please also speak" signal is pointless when spoken output is off). Note the one-word-two-meanings across layers: `conversationMode` in the KNOBS registry is the master toggle alone, while `conversationMode` on the MESSAGE payload means master-and-speakReplies. Documented in `CONTEXT.md` + `server/src/protocol.ts`. A future rename of the wire field (e.g. `spokenConversation`) would remove the ambiguity; kept as-is for now.

## Scope note

v1 covers BOTH session types (server-created web sessions via the inline extension; CLI-bridge sessions via the flag relayed on `cli_message` + a `before_agent_start` handler in the extension). A message typed directly into a terminal `pi` (no web client) carries no flag and is correctly inert.
