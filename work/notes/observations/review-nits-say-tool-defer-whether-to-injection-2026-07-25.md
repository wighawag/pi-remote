---
title: review-gate non-blocking nits for 'say-tool-defer-whether-to-injection' (Gate 2 approve)
date: 2026-07-25
status: open
reviewOf: say-tool-defer-whether-to-injection
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'say-tool-defer-whether-to-injection' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the drift-guard implementation choice: the lockstep check parses the extension TypeScript SOURCE (indexOf on name: say, then double-quoted string-literal extraction between the field labels) instead of importing a shared module like the conversation-mode-hint guard does. It fails loudly (throw or mismatch) on any restructure, so it is safe, but it is brittle against a quote-style change, field reordering, a template literal, or a bracket inside a guideline. Was this the intended trade-off, or should the say text be hoisted into twin modules (say-text.ts on each side) so the guard can import rather than parse?
  (server/test/say-tool.test.ts readExtensionSayText(); the task only asked for 'ideally a lockstep check mirroring the conversation-mode-hint drift guard', which imports both modules. Verified independently: description, promptSnippet and all 4 guidelines are byte-identical across server/src/say-tool.ts and extension/src/index.ts.)
- The say text now hard-points at the injected hint's wording (call say ONLY when the instructions for THIS turn explicitly state that a spoken conversation is active), and CONVERSATION_MODE_HINT happens to open with exactly that sentence. Nothing guards that coupling: a future reword of the hint (e.g. to 'conversation mode is on') would leave the description asking for a phrase that is no longer present, and the ON path could go inert again, the exact regression ADR 0004 fixed. Worth a cross-file assertion (the hint text contains the phrase the say text points at) or a note in ADR 0004?
  (server/src/conversation-mode-hint.ts CONVERSATION_MODE_HINT vs server/src/say-tool.ts description; server/test/conversation-mode-hint.test.ts only pins the two hint twins to each other, and server/test/say-tool.test.ts only pins the two say twins to each other.)
- No Decisions block was recorded on the PR. Besides the guard style above, one other self-made choice to ratify: the pre-existing description test's blob now also folds in promptSnippet (previously description + guidelines only). The original spoken / in addition cues still hold on the description alone, so the assertion is not weakened, but the change was not asked for.
  (server/test/say-tool.test.ts textBlob() used by the 'exposes the say tool with a spoken-reply description' test.)
