---
title: Inline image previews + narrow download/preview tool set to read + attach_file
slug: inline-images-and-narrow-download-tools
spec: inline-media-attachments
blockedBy: []
covers: [1, 2, 3, 4, 7, 8, 10, 11]
---

## What to build

A thin end-to-end slice of the inline-media feature in the web dashboard (`web/`):

1. **Narrow the download/preview tool set.** The web UI currently offers a download button for `attach_file`, `read`, `write`, AND `edit`. Narrow it to `read` + `attach_file` ONLY — drop `write` and `edit` (a download of a file the agent just wrote is noise). This is the single predicate that decides whether a tool card gets a download/preview affordance at all.
2. **Add a media-kind helper.** A single, testable function that classifies a file path by extension (case-insensitive) into `image` / `audio` / `video` / `null`. This task only USES the `image` branch, but define all three kinds now so audio/video slices are pure additions.
3. **Render images inline.** For a tool card that carries a downloadable path (now only `read`/`attach_file`) whose path is an image, render an inline `<img>` preview sourced from the SAME token-gated download URL the download chip already uses (`downloadFileUrl(path)`) — NOT from embedded bytes. The image is wrapped in a tap-to-open link to that URL and lazy-loaded. The existing download chip STAYS; the preview is layered above/beside it, rendered OUTSIDE the collapsible details section so it survives collapse.
4. **De-dup with the model-facing image path.** `read` on an image can ALSO produce model-facing image content blocks that already render as `data:` thumbnails (`msg.images`). When such a message already carries `msg.images`, do NOT also render the download-URL `<img>` — exactly one preview per card.

## Acceptance criteria

- [ ] The download/preview affordance predicate returns a path for `read` and `attach_file` and `null` for `write` and `edit` (and stays `null` for `ls`/`grep`/`find`); a `write`/`edit` tool card renders neither a download chip nor an inline preview.
- [ ] A media-kind helper classifies by extension case-insensitively: image = `png jpg jpeg gif webp bmp svg avif`; audio = `mp3 wav oga ogg m4a aac flac opus`; video = `mp4 webm mov m4v ogv`; everything else (and directory/search paths) = `null`.
- [ ] An `attach_file` on an image renders exactly one inline `<img>` (from the download URL) outside the collapsible section, wrapped in a tap-to-open link, lazy-loaded, with the download chip still present.
- [ ] A `read` on an image renders exactly ONE preview — no duplicate between the model-facing `msg.images` path and the download-URL path.
- [ ] Unsupported / non-image paths fall back to the existing download chip with no preview (graceful).
- [ ] Tests cover the new behaviour (mirror the repo's existing test style): unit tests for the media-kind helper (each kind + `null`, case-insensitivity) and for the narrowed predicate (`read`/`attach_file` → path, `write`/`edit` → `null`); a component-level check that an image path renders one inline `<img>` and that a `read`-with-`msg.images` renders no duplicate.

## Blocked by

- None — can start immediately.

## Prompt

> Goal: add inline IMAGE previews to the Wherever web dashboard's tool cards, driven by the existing tool-call → download-URL affordance, and at the same time NARROW that affordance to `read` + `attach_file` only.
>
> FIRST, drift-check against reality: confirm the download affordance is still wired the way this task assumes — a helper that extracts a single downloadable path from a tool call (currently allowing `attach_file`/`read`/`write`/`edit`), an authenticated download-URL builder (`downloadFileUrl`) hitting `GET /session/download`, an `attach_file` first-class attachment card, and a pre-existing model-facing image render (`msg.images` as `data:` URIs). If any has changed, reconcile before building.
>
> Where to look (by concept, not brittle paths): the chat message list component in `web/src/lib/` owns tool-card rendering, the path-extraction predicate, and the `msg.images` block; the download-URL builder lives in the web lib module beside it.
>
> Key decisions already made (do not re-litigate): the preview is sourced from the DOWNLOAD URL, never from embedded bytes (this keeps attachments cheap and is what later unlocks audio/video); the model-facing `msg.images` `data:`-URI path is left AS-IS and must NOT be duplicated; the download chip STAYS and the preview is additive and rendered OUTSIDE the collapsible section; detection is by file EXTENSION only (the path is already server-validated — no client MIME sniffing).
>
> Define the media-kind helper with all three kinds (image/audio/video) now even though only `image` is used here, so the audio/video tasks are pure additions.
>
> Done = the affordance is `read`+`attach_file` only, images preview inline once per card with the chip intact, and the tests above pass. Changeset per AGENTS.md: web-only → `"wherever-dev": patch` (never `@wherever-dev/web`).
