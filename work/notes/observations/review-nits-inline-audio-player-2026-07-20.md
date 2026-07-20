---
title: review-gate non-blocking nits for 'inline-audio-player' (Gate 2 approve)
date: 2026-07-20
status: open
reviewOf: inline-audio-player
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'inline-audio-player' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: the generic tool-card AUDIO branch is gated only on `dlUrl && dlKind === 'audio'`, deliberately WITHOUT the `!(msg.images && msg.images.length > 0)` de-dup guard the sibling IMAGE branch carries. Correct-as-built (msg.images only ever holds base64 IMAGE blocks, so a read-on-audio never populates it; image/audio branches are mutually exclusive by dlKind), and the agent recorded it in work/notes/observations/inline-audio-read-branch-omits-msg-images-dedup.md. No action needed unless a future change lets msg.images carry non-image blocks.
  (ChatMessageList.svelte:1471 (image, guarded) vs 1493 (audio, unguarded); observation note records the rationale.)
