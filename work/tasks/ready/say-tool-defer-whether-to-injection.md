---
title: Make the say tool defer WHETHER-to-speak entirely to the per-turn injection (kill off-mode false positives)
slug: say-tool-defer-whether-to-injection
spec: conversation-mode
blockedBy: []
covers: [10, 14]
---

## What to build

Stop the `say` tool from being triggered when conversation mode is OFF. Now that the `conversation-mode-agent-signal` injection is the AUTHORITATIVE per-turn "a spoken conversation is active, add a `say` reply" signal (via `before_agent_start`, ADR 0004), the `say` tool's own description still ALSO invites the agent to decide FOR ITSELF when a conversation is "active" ("Emit a short spoken-form reply ... while a spoken conversation is active"). The agent can misjudge that from context (the user speaking naturally, a chatty exchange) and call `say` when the mode is off. Observed on the current build; the injection does not remove this because the standing description keeps inviting the guess.

The fix is a clean separation of concerns in the `say` tool text: **the description owns HOW to use `say`; the per-turn injection owns WHETHER to use it.**

- **Remove every cue that invites the agent to independently JUDGE whether a spoken conversation is active.** Drop phrasing like "while a spoken conversation is active" as a STANDING condition the agent evaluates, and any "when a spoken conversation is active you are told so" reasoning that still frames it as the agent's call.
- **Make the default OFF-unless-explicitly-told, firmly.** The description must state that `say` is driven ONLY by an explicit per-turn instruction: do NOT call it unless THIS turn's instructions explicitly say a spoken conversation is active; there is no other signal; absent that explicit instruction, never call `say`. (This is the mechanical truth: the ONLY positive trigger is the injected hint.)
- **Keep the HOW.** Retain the shape guidance: `say` is an ADDITIVE short spoken layer (one or two sentences, plain spoken language, no code/markdown/lists) on top of the normal written answer, never a replacement; the full detail stays in the written message.
- **Apply to BOTH copies in lockstep** (`server/src/say-tool.ts` and the `@wherever-dev/pi` extension registration in `extension/src/index.ts`), and to the `promptSnippet` + `promptGuidelines` too, so no leftover guideline re-invites the guess.

Net effect: when the mode is OFF (no injection this turn), the agent has NO standing invitation to speak and will not call `say`; when the mode is ON, the injected hint is the explicit instruction the description now points at. This is guidance, not a hard gate (a description cannot make it impossible), but it removes the standing invitation that produces the false positives; a hard "not even registered when off" guarantee is a deliberately separate, larger change and is OUT of scope here.

## Acceptance criteria

- [ ] The `say` description no longer contains any STANDING "while/when a spoken conversation is active" condition that frames the activeness judgement as the agent's own; it instead states `say` must NOT be called unless THIS turn's instructions explicitly say a spoken conversation is active, and that absent that explicit per-turn instruction it is never called.
- [ ] The description still conveys HOW: an additive short (one or two sentences) plain-spoken reply on top of (never instead of) the written answer, no code/markdown/lists.
- [ ] The `promptSnippet` and `promptGuidelines` carry the same defer-to-injection framing (no leftover guideline that re-invites the agent to decide activeness on its own).
- [ ] Both copies (`server/src/say-tool.ts` and the extension registration) are updated identically (lockstep), and the existing say-description test still passes (the description must still read as a SPOKEN, ADDITIVE reply, i.e. still contains the "spoken" + "in addition" cues the test checks).
- [ ] With conversation mode OFF (no per-turn injection), the agent has no standing description-level invitation to call `say` (verified by the description text asserting the explicit-instruction-only rule); behaviour with the mode ON is unchanged (the injected hint is the explicit trigger).
- [ ] Tests cover the new behaviour (mirror the repo's existing test style): extend the say-tool description test to assert the new "only when explicitly instructed this turn / not otherwise" framing is present (and the additive/spoken cues remain); ideally add a lockstep check that the extension copy matches (mirroring the conversation-mode-hint drift guard), or at minimum assert the server copy's new wording.

## Blocked by

- None - can start immediately. It builds on `conversation-mode-agent-signal` (merged, `tasks/done/`), which provides the per-turn injection this description now defers to (ADR 0004). No code dependency beyond that already-merged signal.

## Prompt

> Goal: stop the `say` tool from firing when conversation mode is OFF. The `conversation-mode-agent-signal` change (merged; ADR 0004 in `docs/adr/`) already injects an authoritative per-turn "a spoken conversation is active, add a `say` reply" instruction via `before_agent_start`. But the `say` tool's own DESCRIPTION still invites the agent to independently decide when a conversation is "active", so it sometimes calls `say` with the mode off. Fix the tool TEXT so the description owns HOW to use `say` and the per-turn injection owns WHETHER.
>
> FIRST, drift-check: confirm the `say` description + promptSnippet + promptGuidelines still live in BOTH `server/src/say-tool.ts` and the `@wherever-dev/pi` extension registration (`extension/src/index.ts`), kept in lockstep (a dual registration, like the tool itself). Confirm the per-turn injection is in place (see `docs/adr/0004-*.md` + `server/src/conversation-mode-hint.ts` / `extension/src/conversation-mode-hint.ts`) so the description can safely DEFER the whether-decision to it. Confirm the existing description test (`server/test/say-tool.test.ts`) asserts the description contains 'spoken' + 'in addition' - your new wording must keep those.
>
> The change (do not re-litigate the direction): make the description DEFER the whether-to-speak decision ENTIRELY to the per-turn injection. Remove any standing "while a spoken conversation is active" condition the agent evaluates itself; state firmly that `say` must NOT be called unless THIS turn's instructions explicitly say a spoken conversation is active, that there is no other signal, and that absent that explicit per-turn instruction it is never called. KEEP the HOW: an additive, short (one or two sentences), plain-spoken reply on top of (never instead of) the written answer, no code/markdown/lists. Update the description, promptSnippet, and promptGuidelines in BOTH copies identically; do not leave a guideline that re-invites the guess.
>
> This is GUIDANCE, not a hard gate - a description cannot make an off-mode call impossible. A hard "do not even register `say` when the mode is off" guarantee is a deliberately SEPARATE, larger change (dynamic per-session tool registration) and is OUT of scope here; do not attempt it.
>
> Test at the same seam as the existing description test: assert the new explicit-instruction-only framing is present AND the additive/spoken cues remain; prefer also asserting the extension copy matches (mirror the `conversation-mode-hint` drift guard) so the two cannot drift.
>
> Done = the description/guidelines defer whether-to-speak to the injection in both copies, the existing + new tests pass, and off-mode behaviour no longer has a standing invitation to call `say`. Changeset per AGENTS.md: the `say` text lives in `server/` + `extension/`, so `"wherever-dev": patch` AND `"@wherever-dev/pi": patch`. Never `@wherever-dev/web`.
