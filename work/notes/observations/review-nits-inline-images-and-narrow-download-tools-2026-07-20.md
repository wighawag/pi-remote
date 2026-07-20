---
title: review-gate non-blocking nits for 'inline-images-and-narrow-download-tools' (Gate 2 approve)
date: 2026-07-20
status: open
reviewOf: inline-images-and-narrow-download-tools
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'inline-images-and-narrow-download-tools' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- The acceptance criteria list a component-level render check (one inline img per card; no duplicate on read-with-msg.images), but only pure-unit tests for media-kind + extractDownloadablePath were added. Ratify: no component test was written.
  (web/vitest.config.ts is deliberately node-only pure-TS and its own comment defers jsdom+svelte component tests to later; the repo has NO existing component tests, so the agent extracted the logic into a pure module (media-kind.ts) and unit-tested it, and guaranteed de-dup via two mutually-exclusive {#if} guards. This mirrors the established test style; standing up jsdom+svelte infra would be out of proportion for this slice. Reasonable, but the human may want a follow-up task for component coverage.)
- Ratify an unrecorded in-scope decision (no ## Decisions block in the PR/commit): extractDownloadablePath was MOVED out of ChatMessageList.svelte into web/src/lib/core/media-kind.ts.
  (The move colocates the affordance predicate with mediaKind as two halves of one decision, makes both unit-testable, and CONTEXT.md was updated to point at the new home. Coherent and low-risk, but it is a design choice the task did not explicitly specify.)
