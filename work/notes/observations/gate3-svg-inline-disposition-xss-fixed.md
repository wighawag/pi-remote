---
title: Gate-3 caught + fixed an SVG inline-disposition XSS regression from inline-video-player-and-range
date: 2026-07-20
status: resolved
reviewOf: inline-video-player-and-range
fixedIn: dd6a55c
---

## What happened

The `inline-video-player-and-range` task added `dispositionTypeFor()` in
`server/src/index.ts`, flipping the `GET /session/download` handler to serve
media (`audio/*`, `video/*`, `image/*`) with `Content-Disposition: inline` so
`<video>`/`<audio>`/`<img>` render in-chat. Its Gate-2 review raised (non-blocking)
that this also flipped `image/svg+xml` — previously `attachment` — to `inline`.

## Why it mattered (the judgement call)

The task's acceptance criteria EXPLICITLY required "the existing security posture
UNCHANGED". An SVG can embed `<script>`, and the web preview treats `.svg` as an
image (`IMAGE_EXTS` in `web/src/lib/core/media-kind.ts` includes `svg`), rendering
both an `<img src={downloadUrl}>` AND a tap-to-open `<a href={downloadUrl}>`.
While `<img>` never executes SVG script, NAVIGATING to the inline SVG (the
tap-to-open link, same-origin) DOES — a stored-XSS vector in the app origin.
So this was not a benign nit: it was a real regression against an explicit
criterion. In `--merge` mode (no PR to block) the Gate-3 verdict is a fix, not a
BLOCK — a fixable regression the gate surfaced is a conductor move.

## The fix (dd6a55c)

`dispositionTypeFor()` now returns `attachment` for `image/svg+xml` before the
`image/*` inline branch. SVG is NOT needed for `<video>`/`<audio>` seeking and
previews fine via `<img src>` regardless of disposition, so forcing SVG back to
`attachment` closes the hole at zero functional cost and restores the pre-feature
posture. Added a server test (`session-download-range.test.ts`) asserting SVG
stays `attachment` while audio/video keep `inline`. Full verify green
(format + build:all + `pnpm run -r test`: client 46 / server 19 / web 31).

## Residual

None functional. If a future change lets a raster `image/*` type carry active
content, revisit the inline set. The other two video-task nits (media→inline
disposition for playback; first-range-only + 416 handling) were ratified as
correct-as-built.
