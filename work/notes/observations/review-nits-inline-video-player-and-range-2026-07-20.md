---
title: review-gate non-blocking nits for 'inline-video-player-and-range' (Gate 2 approve)
date: 2026-07-20
status: open
reviewOf: inline-video-player-and-range
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'inline-video-player-and-range' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- [RESOLVED in dd6a55c — Gate-3] SVG served inline was a stored-XSS vector introduced by the disposition change. dispositionTypeFor() returned inline for any image/* type, and .svg maps to image/svg+xml. Previously SVGs got attachment (forced download); the change served them Content-Disposition: inline from the server origin, and SVG can embed script (a tap-to-open of the same-origin download URL would execute it). The task EXPLICITLY required the security posture be preserved unchanged, so this was a real regression, not a benign nit. FIXED: dispositionTypeFor() now returns attachment for image/svg+xml before the image/* branch; a server test asserts SVG stays attachment while audio/video keep inline. See work/notes/observations/gate3-svg-inline-disposition-xss-fixed.md.
  (server/src/index.ts dispositionTypeFor(); MIME_TYPES '.svg':'image/svg+xml'.)
- Ratify recorded decision: media (audio/video/image) served Content-Disposition: inline while non-media stays attachment. Needed for inline <video>/<audio> playback; ASCII + RFC 5987 filename preserved on both. Reasonable and reversible.
  (changeset Decisions block; server/src/index.ts dispositionTypeFor + contentDisposition.)
- Ratify recorded decision: only the FIRST range of a (possibly multi-range) header is honoured (no multipart/byteranges); unsatisfiable range -> 416 with Content-Range bytes */size; suffix range bytes=-N supported. Sufficient for media seeking and matches the task's suggested handling.
  (changeset Decisions block; parseRangeHeader() + 416 branch.)
