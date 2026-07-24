---
title: review-gate non-blocking nits for 'say-tool-dual-registration' (Gate 2 approve)
date: 2026-07-24
status: open
reviewOf: say-tool-dual-registration
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'say-tool-dual-registration' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- The extension say execute(_toolCallId, params) uses the 2-arg signature while the sibling attach_file uses the fuller (_toolCallId, params, _signal, _onUpdate, ctx). Harmless (say needs no ctx), but worth a glance for consistency.
  (extension/src/index.ts:567 vs :471)
- Ratify design choice made in build: on blank text the tool returns isError:true with details:undefined and message 'say: no text provided.' (mirrors attach_file). Not spelled out verbatim in the task but consistent with the pattern.
  (say-tool.ts execute error branch; task AC says blank->error result touching nothing)
