---
title: Inline video player + server HTTP Range support for media seeking
slug: inline-video-player-and-range
spec: inline-media-attachments
blockedBy: [inline-audio-player]
covers: [6, 9]
---

## What to build

Two coupled changes so attached VIDEO plays and SEEKS inline in the web dashboard:

1. **Web (`web/`):** a tool card whose downloadable path is video renders an inline `<video controls playsinline>` player sourced from the same token-gated download URL, capped in size, rendered outside the collapsible section, with the download chip still present. Reuse the media-kind helper's `video` branch.
2. **Server (`server/`):** teach the `GET /session/download` handler to honour HTTP `Range` requests so `<video>` (and `<audio>`) can seek/scrub. Currently the handler always returns a full `200` with `Content-Disposition: attachment` and no range support, and its MIME map has NO audio/video types (so those files are served as `application/octet-stream`, which browsers will not play). Fix both:
   - Parse `Range: bytes=start-end`; respond `206 Partial Content` with `Content-Range`, `Accept-Ranges: bytes`, and a correctly-sliced stream; fall back to full `200` when there is no `Range` header.
   - Serve a correct media `Content-Type` for audio/video extensions (extend the MIME map), and ensure the disposition/headers allow inline playback (an `attachment` disposition can suppress inline rendering — use the appropriate disposition/headers for media while keeping the ASCII + RFC 5987 filename encoding already present).
   - PRESERVE the existing security posture unchanged: deny-by-default path resolution (realpath + containment, out-of-root → `404`), the size cap (`413`), and the `downloads.enabled: false` disable (`403`).

## Acceptance criteria

- [ ] A tool card whose downloadable path is video (`mp4 webm mov m4v ogv`) renders an inline `<video controls playsinline>` from the download URL, size-capped, outside the collapsible section, with the download chip still present.
- [ ] `GET /session/download` with a `Range: bytes=start-end` header returns `206` with a correct `Content-Range`, `Accept-Ranges: bytes`, and a correctly-sliced body; the same request with NO `Range` header returns the full `200`.
- [ ] Audio and video files are served with a correct media `Content-Type` (not `application/octet-stream`) and headers that permit inline playback.
- [ ] Video seeking/scrubbing works in the browser (desktop and iOS `playsinline`); audio seeking also benefits from Range.
- [ ] The deny-by-default path resolution (out-of-root → `404`), the size cap (`413`), and the `downloads.enabled: false` disable (`403`) are UNCHANGED and still enforced on the Range path.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style): a server test asserting `206` + `Content-Range` + `Accept-Ranges: bytes` + sliced body for a `Range` request, a full `200` for no-Range, the correct media Content-Type, and that out-of-root/oversized/disabled still return `404`/`413`/`403` on the Range path; a component-level check that a video path renders `<video controls playsinline>` from the download URL.
- [ ] **Shared-write isolation:** the server download tests operate on temp/scratch fixture files within an allowed root and assert no real home/system path is read or written — they do not touch a real shared location.

## Blocked by

- `inline-audio-player` — extends the same web inline-preview seam (serialized to avoid parallel edits to the same block). The server change is independent but lands with this task.

## Prompt

> Goal: make attached VIDEO play and SEEK inline in the Wherever web dashboard, which requires both a web `<video>` render and server-side HTTP Range support (+ correct media MIME types) on the download endpoint.
>
> FIRST, drift-check: confirm the media-kind helper (`video` branch) and the shared inline-preview block exist from the earlier slices, and read the CURRENT `GET /session/download` handler — verify it still (a) always returns a full `200` with `Content-Disposition: attachment`, (b) has no `Range` handling, and (c) has a MIME map lacking audio/video types. If any of these has already changed, reconcile before building.
>
> Where to look (by concept): the web chat message list component + web lib download-URL builder (add a `video` branch beside image/audio); the server's HTTP request handler that serves `/session/download`, its `mimeTypeFor` MIME map, and its deny-by-default path resolver + size cap + downloads-enabled gate (all of which MUST stay intact).
>
> Decisions/constraints (do not re-litigate): source the player from the download URL; render outside the collapsible section; keep the download chip; detection by extension only; security posture (realpath containment → 404, size cap → 413, disabled → 403) is preserved verbatim and must be re-asserted by tests on the Range code path. Record any non-obvious in-scope decision (e.g. the exact disposition chosen for inline media, or how an unsatisfiable/multi-range request is handled) durably per WORK-CONTRACT.md — a silent choice is a review finding.
>
> Done = video previews and seeks inline, the endpoint honours Range with correct media Content-Type, the security posture is unchanged and tested, and all tests above pass. Changeset per AGENTS.md: web + server changes → `"wherever-dev": patch` (never `@wherever-dev/web`).
