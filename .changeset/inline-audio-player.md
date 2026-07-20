---
"wherever-dev": patch
---

Web dashboard: play audio attachments inline in tool cards.

- A downloadable path (now `read` + `attach_file`) whose extension is audio (`mp3 wav oga ogg m4a aac flac opus`) renders an inline `<audio controls preload="metadata">` player, sourced from the SAME token-gated `downloadFileUrl(path)` as the image preview (not embedded bytes), OUTSIDE the collapsible section so it survives collapse.
- The download chip stays, so an unsupported audio format degrades gracefully to the chip.
- Images/video and non-media paths are unaffected — the audio branch keys purely off `mediaKind(path) === 'audio'`, beside the existing `image` branch, in both the `attach_file` attachment card and the generic tool card.
