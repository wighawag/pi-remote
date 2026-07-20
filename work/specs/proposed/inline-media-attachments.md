---
title: Inline media (image / audio / video) for downloadable tool cards
slug: inline-media-attachments
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `CONTEXT.md` + `docs/` (decisions) + the code; remaining work: the tasks sliced from this spec.

## Problem Statement

The web UI already turns file-oriented tool calls into a token-gated `GET /session/download` link (`downloadFileUrl()` in `web/src/lib/wherever.ts`, wired in `ChatMessageList.svelte`). Today an attached image is only offered as a **download chip** — the user must tap and leave the chat to see it. The user wants media to render **inline** in the chat, driven by the same tool CALL that already produces the download URL, so images/audio/video are previewable without leaving the conversation.

The download affordance is also currently OVER-BROAD: `extractDownloadablePath()` in `ChatMessageList.svelte` offers the button for `attach_file`, `read`, `write`, AND `edit`. This spec NARROWS it to `read` + `attach_file` only — the two tools where a download/preview is meaningful (an intentional attachment, or a file the agent read). `write`/`edit` are write-side operations where offering the user a download of what the agent just wrote is noise, so they are dropped from the download/preview tool set.

Scope is `web/` only (rendering + the tool-set narrowing), plus one small server-side range-handling hardening for video/audio seeking. No protocol change, no server-side model-input change.

## Solution

Render media **inline** in the chat from the existing `downloadFileUrl(path)` URL — i.e. from the tool CALL's path, with NO bytes in the message. This unlocks audio/video and keeps attachments cheap, and works for both CLI-bridge and server-side sessions because both already stream `tool_start`/`tool_end` and the URL is built the same way the download chip is.

The download chip STAYS. Inline media is an enhancement layered on top of it (chip remains for save/share; a preview is added above/beside it).

### Two DIFFERENT image paths — do not conflate them

There are already TWO ways an image can show up; this spec adds to the second:

1. **Model-facing image blocks (already exists — leave AS-IS).** `read` on an image file makes the tool result carry image content blocks (base64). Those arrive on the message as `msg.images` and render in `ChatMessageList.svelte` as `data:${mimeType};base64,${data}` thumbnails, OUTSIDE the collapsible section. Only works when the tool result embeds the bytes, and it base64-bloats the payload.
2. **Download-URL media (this spec).** Render media inline from `downloadFileUrl(path)` — from the tool CALL's path, NO bytes in the message.

## User Stories

1. As a web user, when an agent attaches an image via `attach_file`, I want to see the image rendered inline in the chat (above/beside the existing download chip), so that I do not have to tap and leave the conversation to view it.
2. As a web user, when an agent `read`s an image file, I want an inline preview of that image, so that file reads are visible in context.
3. As a web user, I want inline images to remain tap-to-open (wrapped in a link to the download URL) and lazy-loaded, so that saving/sharing still works and the chat stays light.
4. As a web user, I want a `read`-on-image to show exactly ONE preview — never a duplicate between the model-facing `msg.images` path and this download-URL path.
5. As a web user, when an agent attaches audio (`.mp3`/`.oga`/…), I want an inline `<audio controls>` player, so that I can listen without downloading.
6. As a web user, when an agent attaches video (`.mp4`/`.webm`/…), I want an inline `<video controls playsinline>` player that also SEEKS/scrubs correctly on desktop and iOS.
7. As a maintainer, I want media-kind detection to be a single, testable helper keyed by file extension (case-insensitive), so that images/audio/video are classified consistently wherever a download URL exists.
8. As a maintainer, I want inline previews rendered OUTSIDE the collapsible details section (same as the existing `msg.images` block), so that a preview stays visible when the tool card is collapsed.
9. As a maintainer, I want the server's `GET /session/download` to honor HTTP `Range` requests (`206 Partial Content` + `Accept-Ranges: bytes` + `Content-Range`), so that `<video>`/`<audio>` seeking works, while keeping the existing deny-by-default path resolution and size cap.
10. As a web user, I want unsupported codecs/formats to degrade gracefully to the download chip (which always remains), so that a browser that cannot play a file still lets me save it.
11. As a web user, I want the download/preview affordance to appear ONLY for `read` and `attach_file` — NOT for `write` or `edit` — so that I am not offered a download of a file the agent just wrote (which is noise), keeping the affordance to files I meaningfully want (an attachment, or a file that was read).

## Out of Scope

- **No model-input media beyond today.** We do NOT teach `read` to feed audio/video content blocks to the model — that depends on model/pi support and is a separate future item. `read`'s existing image-block behavior is untouched.
- No transcoding, thumbnail generation, or streaming server — serve the raw file and let the browser handle codecs.
- No new WS message type, no new chat role, no side channel — everything is driven by the existing tool call + `/session/download`.
- Client-side MIME sniffing — detection is by extension only (the path is already server-validated).

## Implementation Decisions

- **Media-kind helper.** Add `mediaKindForPath(path)` returning `'image' | 'audio' | 'video' | null` (in `web/src/lib/wherever.ts` alongside `downloadFileUrl`, or a small `web/src/lib/core/media.ts`). Extension → kind mapping (case-insensitive):
  - **image**: `png jpg jpeg gif webp bmp svg avif`
  - **audio**: `mp3 wav oga ogg m4a aac flac opus`
  - **video**: `mp4 webm mov m4v ogv`
- **Where it renders.** For any tool card that has a `dlPath`/`dlUrl` (the existing `parsed.downloadPath`), compute `mediaKindForPath(dlPath)` and, when non-null, render a preview block adjacent to the existing chip, OUTSIDE the collapsible details section:
  - **image** → `<img src={dlUrl}>` capped at `max-h-96 max-w-full object-contain`, wrapped in `<a href={dlUrl} target="_blank">`, `loading="lazy"`. Mirror the styling used for `msg.images` thumbnails so both image paths look identical.
  - **audio** → `<audio controls preload="metadata" src={dlUrl}>`.
  - **video** → `<video controls preload="metadata" playsinline src={dlUrl}>` capped at `max-h-96 max-w-full`.
- **Which tools (NARROWED).** The download chip AND the inline preview apply to `attach_file` (intentional) and `read` (opportunistic) ONLY. Drop `write` and `edit` from `extractDownloadablePath()` in `ChatMessageList.svelte` (currently `['attach_file', 'read', 'write', 'edit']` → `['attach_file', 'read']`); `ls`/`grep`/`find` remain excluded as today. This narrowing removes a pre-existing over-broad download button on write-side tool cards, and by construction the inline preview (built on the same `dlPath`) never appears on `write`/`edit` either.
- **De-dup rule.** For the generic file-tool card (`read` etc.), render the inline `<img>` from `dlUrl` only when the message does NOT already carry `msg.images` (avoid a duplicate with the model-facing path).
- **Server range handling (video/audio seeking).** `GET /session/download` in `server/src/index.ts` must parse `Range: bytes=start-end`, respond `206` with `Content-Range` + `Accept-Ranges: bytes` + a sliced stream, and fall back to full `200` when no `Range` header — keeping the existing deny-by-default path resolution + size cap.
- **Staging (each slice independently shippable):** (1) narrow the download tool set to `read` + `attach_file` AND render images inline; (2) audio inline; (3) video inline + HTTP Range. The tool-set narrowing rides slice 1 because both edit the same `extractDownloadablePath()` / preview seam in `ChatMessageList.svelte`.

## Testing Decisions

- **`mediaKindForPath()`** — unit test the extension → kind mapping (case-insensitive, each kind, and `null` for non-media / `ls`-style paths).
- **Rendering** — component-level test in `ChatMessageList.svelte`: an `attach_file` image path renders one inline `<img>` outside the collapsible section with the download link intact; a `read`-on-image with `msg.images` present renders exactly one preview (no dup); an audio/video path renders the corresponding `<audio>`/`<video controls>`.
- **Tool-set narrowing** — unit/component: `extractDownloadablePath()` returns a path for `read` and `attach_file` but `null` for `write` and `edit` (and stays `null` for `ls`/`grep`/`find`); a `write`/`edit` tool card renders neither a download chip nor an inline preview.
- **Server range** — request `GET /session/download` with a `Range` header and assert `206` + `Content-Range` + `Accept-Ranges: bytes` and a correctly-sliced body; a request with no `Range` still returns full `200`; the deny-by-default path resolution and size cap are unaffected.

## Further Notes

- Related context: `CONTEXT.md` → "File Download / Attachments".
- Changeset rule (`AGENTS.md`): web-only rendering + a server range-handling tweak → `"wherever-dev": patch` (the `web` package is private and served by `wherever-dev`; never bump `@wherever-dev/web`).
