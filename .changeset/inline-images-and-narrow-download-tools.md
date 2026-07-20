---
"wherever-dev": patch
---

Web dashboard: preview images inline in tool cards and narrow the download/preview affordance to `read` + `attach_file`.

- Narrowed `extractDownloadablePath()` from `attach_file`/`read`/`write`/`edit` to `read` + `attach_file` only — a `write`/`edit` card no longer renders a download chip (a download of a just-written file is noise).
- Added a `mediaKind()` helper (`web/src/lib/core/media-kind.ts`) classifying a path by extension (case-insensitive) into `image`/`audio`/`video`/`null`; only `image` is used now (audio/video are pure additions later).
- A downloadable image path now renders an inline `<img>` preview from the SAME token-gated `downloadFileUrl(path)` (not embedded bytes), OUTSIDE the collapsible section, tap-to-open and lazy-loaded, with the download chip still present.
- De-duped against the model-facing `msg.images` `data:` path (left as-is): a `read`-on-image shows exactly one preview.
