---
title: Inline audio player for downloadable tool cards
slug: inline-audio-player
spec: inline-media-attachments
blockedBy: [inline-images-and-narrow-download-tools]
covers: [5]
---

## What to build

Extend the inline-media rendering in the web dashboard so that a tool card carrying a downloadable path (already narrowed to `read` + `attach_file`) whose path is AUDIO renders an inline `<audio controls>` player sourced from the same token-gated download URL used for images. Reuse the media-kind helper's `audio` branch added in the images task. The player uses metadata preload, the download chip stays, and the player renders OUTSIDE the collapsible details section (same placement as the image preview). Unsupported audio formats degrade to the download chip.

## Acceptance criteria

- [ ] A tool card whose downloadable path is audio (`mp3 wav oga ogg m4a aac flac opus`) renders an inline `<audio controls>` element sourced from the download URL, outside the collapsible section, with the download chip still present.
- [ ] Non-audio / image / video paths are unaffected (image still renders as before; audio does not appear on them).
- [ ] `write`/`edit`/`ls`/`grep`/`find` still render no preview and (for write/edit) no download chip.
- [ ] An unsupported audio format the browser cannot play degrades gracefully to the download chip.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style): a component-level check that an audio path renders an `<audio controls>` from the download URL and that a non-audio path does not.

## Blocked by

- `inline-images-and-narrow-download-tools` — introduces the media-kind helper and the shared preview seam in the chat message list component this task extends (serialized to avoid editing the same block in parallel).

## Prompt

> Goal: add inline AUDIO playback to the Wherever web dashboard's tool cards, layered on the image-preview slice.
>
> FIRST, drift-check: confirm the media-kind helper (with an `audio` branch) and the shared inline-preview block exist as delivered by `inline-images-and-narrow-download-tools`, and that the download affordance is already narrowed to `read`+`attach_file`. If the helper or seam differs, reconcile before building.
>
> Where to look: the same chat message list component and web lib module the images task touched. Add an `audio` rendering branch beside the `image` branch, sourced from the same `downloadFileUrl(path)`.
>
> Decisions inherited (do not re-litigate): source from the download URL (no embedded bytes); render outside the collapsible section; keep the download chip; detection by extension only.
>
> Done = audio attachments play inline via `<audio controls>` with the chip intact, images/video unaffected, and the test above passes. Changeset per AGENTS.md: web-only → `"wherever-dev": patch`.
