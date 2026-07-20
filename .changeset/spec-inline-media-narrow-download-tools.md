---
"wherever-dev": patch
---

Refine the proposed `inline-media-attachments` spec: NARROW the download/preview
tool set to `read` + `attach_file` only, dropping the pre-existing over-broad
download button on `write`/`edit` tool cards (`extractDownloadablePath()` goes from
`['attach_file','read','write','edit']` to `['attach_file','read']`). The narrowing
rides slice 1 (same `ChatMessageList.svelte` seam as image-inline), with a matching
user story and test. Spec-only change; no runtime code touched yet.
