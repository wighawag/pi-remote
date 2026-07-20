---
"wherever-dev": patch
---

Play video attachments inline in the web dashboard, backed by server-side HTTP Range support so media can seek/scrub.

- Web: a downloadable path (`read` + `attach_file`) whose extension is video (`mp4 webm mov m4v ogv`) renders an inline `<video controls playsinline preload="metadata">` player sourced from the SAME token-gated `downloadFileUrl(path)` (not embedded bytes), OUTSIDE the collapsible section, with the download chip still present. The branch keys purely off `mediaKind(path) === 'video'`, beside the existing `image`/`audio` branches, in both the `attach_file` attachment card and the generic tool card.
- Server: `GET /session/download` now honours a single `Range: bytes=start-end` header — `206 Partial Content` with `Content-Range` + `Accept-Ranges: bytes` + a byte-exact sliced stream, a suffix range (`bytes=-N`), `416` for an unsatisfiable range, and a full `200` (advertising `Accept-Ranges: bytes`) when there is no `Range` header. A multi-range header serves only its first range (no multipart body).
- Server: the MIME map gained audio/video types (mp3/wav/oga/ogg/m4a/aac/flac/opus, mp4/webm/mov/m4v/ogv) so media is served with a playable `Content-Type` instead of `application/octet-stream`, and media (audio/video/image) is served with an `inline` `Content-Disposition` (non-media stays `attachment`) — both keeping the existing ASCII + RFC 5987 filename encoding — so browsers render it in-chat.
- The deny-by-default path resolution (out-of-root → `404`), the size cap (`413`), and the `downloads.enabled: false` gate (`403`) are unchanged and re-asserted by tests on the Range code path.

## Decisions

- **Inline disposition for media.** Media (`audio/`, `video/`, `image/`) is served `Content-Disposition: inline` because an `attachment` disposition can suppress inline `<video>`/`<audio>` playback; non-media keeps `attachment` (the safe save default). The ASCII + RFC 5987 filename is preserved on both.
- **Single-range only.** Only the first range of a (possibly multi-range) header is honoured; the server never emits a `multipart/byteranges` body — a single contiguous slice is all a media element needs to seek. An unsatisfiable range → `416` with `Content-Range: bytes */<size>`.
- Observation captured: the default `uploads.type: 'tmp'` makes all of `os.tmpdir()` an allowed download root (`work/notes/observations/download-tmp-upload-dir-is-an-allowed-root.md`) — out of scope here, flagged for the deny-by-default posture.
