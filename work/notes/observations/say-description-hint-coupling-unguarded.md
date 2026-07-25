---
title: The say description and the conversation-mode hint are coupled but no test binds them (silent ON-path regression risk)
date: 2026-07-25
status: open
relatedTask: say-tool-defer-whether-to-injection
relatedAdr: 0004-conversation-mode-agent-signal-inline-extension-and-lockstep-hint
---

## What was observed

Follow-up from the Gate-2 review of `say-tool-defer-whether-to-injection` (a non-blocking nit worth a small test). After that change:

- The `say` tool DESCRIPTION says: call `say` ONLY when THIS turn's instructions explicitly state that a spoken conversation is active; never otherwise (it owns HOW, defers WHETHER).
- The injected `CONVERSATION_MODE_HINT` says: "A spoken conversation is active for this turn ... also call the `say` tool ...".

These two are COUPLED: the description points at the hint's assertion as the ONLY trigger. But nothing guards the coupling. The two existing drift-guards each only pin the TWINS to each other:

- `server/test/conversation-mode-hint.test.ts` pins the server hint twin to the extension hint twin.
- `server/test/say-tool.test.ts` pins the server `say` text to the extension `say` text.

Neither pins the say-description to the hint. So a future reword of `CONVERSATION_MODE_HINT` (e.g. to "conversation mode is on") that no longer clearly asserts "a spoken conversation is active for this turn" would leave the description asking for a phrase/meaning the hint no longer sends. The agent would then never get its explicit trigger, and the ON path could go INERT again: the exact regression the whole conversation-mode-signal feature (ADR 0004) fixed. It would pass all existing tests silently.

## Impact

Latent, not live: today the hint and description ARE aligned (verified). The risk is a future edit to one file silently breaking the other, with no test catching it, re-inertifying spoken replies.

## Suggested fix (small)

Add ONE cross-file assertion (a test that imports/reads BOTH `CONVERSATION_MODE_HINT` and the `say` description and asserts they share the load-bearing phrase, e.g. both contain "spoken conversation is active"). Or, more robustly, hoist the exact trigger phrase into a single shared constant that BOTH the hint text and the say description are built from, so they cannot diverge by construction. Either binds the coupling ADR 0004 S6 documents.

## Why filed, not fixed inline

Adding a cross-file test (or refactoring to a shared trigger-phrase constant) is a real code change spanning the hint + say modules and their tests; it wants its own small task rather than being slipped into an unrelated change. Cheap to promote when convenient.
