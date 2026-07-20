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

- SVG served inline is a possible stored-XSS vector introduced by the disposition change. dispositionTypeFor() returns inline for any image/* type, and .svg maps to image/svg+xml. Previously SVGs got attachment (forced download); now they are served Content-Disposition: inline from the server origin, and SVG can embed script. Consider excluding image/svg+xml from the inline set (keep it attachment). .html stays attachment (text/html, not a media prefix) so only SVG regresses.
  (server/src/index.ts dispositionTypeFor(): startsWith('image/') -> inline; MIME_TYPES '.svg':'image/svg+xml'. Task required the security posture be preserved unchanged.)
- Ratify recorded decision: media (audio/video/image) served Content-Disposition: inline while non-media stays attachment. Needed for inline <video>/<audio> playback; ASCII + RFC 5987 filename preserved on both. Reasonable and reversible.
  (changeset Decisions block; server/src/index.ts dispositionTypeFor + contentDisposition.)
- Ratify recorded decision: only the FIRST range of a (possibly multi-range) header is honoured (no multipart/byteranges); unsatisfiable range -> 416 with Content-Range bytes */size; suffix range bytes=-N supported. Sufficient for media seeking and matches the task's suggested handling.
  (changeset Decisions block; parseRangeHeader() + 416 branch.)
