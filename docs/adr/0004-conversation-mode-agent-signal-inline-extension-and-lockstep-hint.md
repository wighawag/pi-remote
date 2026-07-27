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

## 6. The `say` description DEFERS the whether-to-speak decision to the injected hint (a cross-file coupling)

A follow-up (`say-tool-defer-whether-to-injection`) reworked the `say` tool description so it no longer invites the agent to judge for itself when a spoken conversation is active (which caused off-mode false-positive `say` calls). WHETHER to speak is now owned ENTIRELY by the per-turn injection: the description tells the agent to call `say` ONLY when THIS turn's instructions explicitly say a spoken conversation is active, and never otherwise. Description owns HOW; the injected hint (`CONVERSATION_MODE_HINT`) owns WHETHER.

COUPLING RISK (recorded so a future editor does not reintroduce the regression this fixed): the `say` description hard-points at the injected hint's meaning ("a spoken conversation is active for this turn"). If `CONVERSATION_MODE_HINT` is ever reworded so it no longer clearly states that a spoken conversation is active for the turn, the description would point at a signal the hint no longer sends, and the ON path could go INERT again (the exact failure this whole feature fixed). The two existing drift-guards only pin the twins to each other (say-twin <-> say-twin, hint-twin <-> hint-twin); NOTHING yet pins the say-description to the hint. When editing either, keep them semantically aligned. A cross-file test assertion (the hint asserts a spoken conversation is active for the turn; the say description requires exactly that as its trigger) is filed as a follow-up (`work/notes/observations/say-description-hint-coupling-unguarded.md`).

## 7. A system-prompt line alone is NOT enough: the signal also rides the TAIL of every LLM call, and the client speaks a fallback

The system-prompt append (sections 1-3) works, but only as far as a model's willingness to follow a line buried in a long prompt. Measured against the local `Ornith-1.0-35B` a reported session actually ran on, with a realistic wherever-shaped system prompt: hint ON 3/6 turns called `say`, hint OFF 1/6 - and at the post-tool-result synthesis call (the answer after a `web_search`) the hint was ignored nearly every time. Two forces defeat it: the hint is far from the tail, and once the transcript shows earlier assistant turns that did NOT speak, the model imitates its own history. That is exactly the reported symptom ("it only speaks when I explicitly ask").

So the same per-turn signal now injects in TWO places, and the client stops depending on the model entirely:

**(a) A TAIL REMINDER via the pi `context` event.** `context` fires before EVERY LLM call (not once per user prompt like `before_agent_start`), and the SDK applies handlers to a `structuredClone` on the way to `convertToLlm` (`transformContext`), so the addition never reaches session state, the transcript or the TUI. `CONVERSATION_MODE_REMINDER` is placed at the very TAIL, where a smaller model reads it, and re-applied for each call of the turn.

Placement is ROLE-SAFE rather than "append a message": Anthropic's first-party API merges consecutive same-role turns, but Bedrock and some compatibility proxies REJECT them, and after a tool result the tail is already a user-role turn. So the reminder rides INSIDE a clone of a `user`/`toolResult` tail as one extra text block, and only becomes its own (`custom`, `display: false`) message when the tail is an assistant turn or the context is empty.

**Turn lifecycle:** `before_agent_start` still consumes the arming, and that now also OPENS the turn (an unflagged turn therefore explicitly closes a previous one); `agent_end` closes it. **Loop guard:** the reminder asks for a tool call, and a tool call means another LLM call, so it is suppressed once an assistant `toolCall` named `say` exists since the last user message. Without that, a model answering with only a `say` call could be nudged into speaking again, and again.

**(b) A CLIENT-SIDE spoken fallback (`web/src/lib/core/speak-fallback.ts`).** `say` is a REQUEST; compliance is a model property the client cannot control, and a conversation mode that goes silent for whole turns is worse than one that is a bit less eloquent. When a turn SETTLES with `speakReplies` active and no `say` was spoken, the client speaks a short plain-text lead-in derived from the written reply (code fences, URLs, markdown markers stripped; first sentences up to ~320 chars). `say` always wins (a turn that spoke is never re-spoken), the written transcript is never modified, and with spoken replies off nothing is ever spoken.

This deliberately narrows the earlier "the spoken text comes ONLY from the agent's explicit `say` call" rule: it still holds for the PRIMARY path and for what the "spoken:" card shows, but silence is no longer an acceptable outcome of a model ignoring an instruction. A future opt-out knob (`speakFallback`) would slot into the existing knobs registry; not added now, since the fallback only ever fires where the mode promised audio and delivered none.

## Scope note

v1 covers BOTH session types (server-created web sessions via the inline extension; CLI-bridge sessions via the flag relayed on `cli_message` + a `before_agent_start` handler in the extension). A message typed directly into a terminal `pi` (no web client) carries no flag and is correctly inert.
