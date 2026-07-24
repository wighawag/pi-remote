---
title: review-gate non-blocking nits for 'collapse-long-replies' (Gate 2 approve)
date: 2026-07-24
status: open
reviewOf: collapse-long-replies
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'collapse-long-replies' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the internal long-reply threshold: LONG_REPLY_CHAR_THRESHOLD=600 chars is a fixed heuristic, NOT a user-configurable knob. This is an in-scope design decision (a user-visible default for what counts as long) recorded inline in collapse-reply.ts but NOT in a PR Decisions block. Reasonable (task scope is a boolean knob, not a length setting) and trivially reversible; confirm 600 is acceptable.
  (web/src/lib/core/collapse-reply.ts LONG_REPLY_CHAR_THRESHOLD=600; commit body is bare with no ## Decisions block)
- Acceptance criterion 4 asks for a component test that a long reply collapses but stays reachable. The agent instead tested the pure decision seam (collapse-reply.test.ts), not a rendered component. Acceptable: the repo has no svelte/jsdom component test infra (only core/*.ts seam tests like speak.test.ts), so this mirrors the repo's actual style, and full-text reachability is enforced structurally (CSS clamp + @html always renders full content). Note the CSS clamp/fade and the Show-full-reply wiring themselves are untested.
  (web/src/lib/core/collapse-reply.test.ts; no *.svelte.test.ts exist in web/; task criterion says mirror the repo's existing test style)
