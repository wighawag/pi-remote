---
"wherever-dev": patch
---

Security fix (Gate-3 follow-up to inline-video-player-and-range): serve
`image/svg+xml` downloads with `Content-Disposition: attachment` again instead
of `inline`. The inline-media disposition change flipped every `image/*` type to
`inline`, which for SVG (which can embed `<script>`) turned a tap-to-open of the
same-origin download URL into a stored-XSS vector. SVG is not needed for inline
`<video>`/`<audio>` seeking and previews fine via `<img src>` regardless of
disposition, so it keeps the safe `attachment` default — preserving the
pre-media-feature security posture. Adds a server test asserting SVG stays
`attachment` while audio/video keep their inline disposition.
