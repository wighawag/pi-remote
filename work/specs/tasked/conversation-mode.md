---
title: Conversation mode — a spoken back-and-forth preset with a short reviewable spoken reply
slug: conversation-mode
needsAnswers: false
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `CONTEXT.md` + `docs/` (decisions) + the code; remaining work: the tasks sliced from this spec.

## Problem Statement

Today the web UI is a typing-first chat: the user types (or dictates via `SpeechButton`) and reads the agent's full reply. There is already a speech-to-text path with a **send-on-speech-end** knob (`directSend` in `web/src/lib/components/speech/SpeechButton.svelte`), so speaking TO the agent works. But:

- The agent's reply is its **full last message** — often long, detailed, code-heavy — which is a poor thing to speak aloud or glance at during a hands-busy spoken exchange.
- There is no "conversation" posture: no bundling of the speech knobs into a single mode the user can flip on, and no way for the agent to emit a SHORT spoken reply distinct from its full written answer.

The user wants a **conversation mode**: a spoken back-and-forth where the user speaks and the agent replies, but the SPOKEN reply is a short, reviewable summary the agent produces on purpose (via a tool call) — not the full last message — so the human hears something short and can SEE when the short version misrepresents the long one. Conversation mode is a **preset over a set of knobs** the user configures; toggling the mode activates that configured set. `directSend` (send-on-speech-end) is one such knob that already exists.

Scope is `web/` (a knobs registry + mode toggle + TTS + hands-free loop wiring) plus a self-contained `say` tool. No new WS message type — `say` rides the existing `tool_start`/`tool_end` stream exactly like `attach_file`.

## Solution

Two pieces, composed:

1. **A `say` tool** — a self-contained, agent-driven tool (the `attach_file` pattern: validate-and-return, no side channel). The agent calls `say({ text })` with a SHORT spoken-form reply. The full written message still exists in the transcript; `say` is the spoken LAYER on top of it (in ADDITION to, not instead of, the normal reply). The web UI recognises the tool CALL and (a) shows the spoken text and (b) speaks it via the browser `SpeechSynthesis` API. Because the affordance is driven by the tool call over the already-streamed `tool_start`/`tool_end`, it works in both session types without a side channel — the same reason `attach_file` works everywhere.

2. **A conversation-mode knobs registry + toggle** — a small, named PRESET of individual boolean/enum knobs, persisted in the existing config. A "Conversation Mode" toggle flips the preset ON, which activates the user-configured set of knobs. The user configures each knob independently; the mode is just a saved bundle of them. This matches the existing pattern in miniature (`directSend`/`engine`/`locale` already persist as independent speech prefs).

The full message stays visible; conversation mode changes the POSTURE (auto-send, speak the short reply, optionally collapse the long reply, optionally re-open the mic), never the underlying transcript.

## User Stories

1. As a user, I want a single **Conversation Mode toggle** in the web UI that flips a bundle of speech/voice knobs ON at once, so that I can enter a spoken back-and-forth without setting each knob every time.
2. As a user, I want conversation mode to be a **preset over individually-configurable knobs**, so that I decide what "conversation mode" means for me (which knobs it activates) and the toggle just applies that set.
3. As a user, I want the existing **send-on-speech-end** behaviour (`directSend`) to be one of the conversation-mode knobs, so that speaking a message auto-sends it when the mode is on.
4. As a user, when conversation mode is on, I want the agent's reply to be **spoken aloud as a SHORT summary** (via the `say` tool + browser TTS), not the full last message read verbatim, so that the spoken exchange stays short and natural.
5. As a user, I want the agent's **full written reply to remain in the transcript** even while the short spoken summary is played, so that I can read the detail and SEE when the spoken summary misrepresents the full answer.
6. As a user, I want a knob to **collapse/de-emphasise long written replies** while conversation mode is on (the spoken summary is the focus), so that the chat stays glanceable — but never to DELETE the full reply.
7. As a user, I want a **hands-free knob** that re-opens the mic after the agent finishes speaking, so that I can carry on the conversation without tapping.
8. As a user, I want a **speak-replies knob** (browser `SpeechSynthesis`) that reads the `say` payload aloud, with graceful no-op when the browser has no TTS, so that voice output is optional and degrades safely.
9. As a user, I want conversation-mode knobs to **persist** (in the existing `wherever-config` / `wherever-speech-*` localStorage), so that my configured mode survives reloads and session switches.
10. As the agent, I want a `say` tool whose description tells me to use it, WHEN CONVERSATION MODE IS ACTIVE, to provide a short spoken-form reply IN ADDITION to my normal written answer, so that the human hears a concise version they can sanity-check.
11. As a user, I want the `say` spoken text surfaced in the chat (a distinct "spoken:" affordance) so that I can visually compare the short spoken reply against the full written one.
12. As a maintainer, I want the `say` tool to be **self-contained** (validate the argument, return a normal tool result, touch no bridge/side-channel), exactly like `attach_file`, so that it works identically in server-side and CLI-bridge sessions.
13. As a maintainer, I want conversation mode to introduce **no new WS message type and no new chat role** — the `say` affordance rides the existing `tool_start`/`tool_end` stream — so that the protocol surface is unchanged.
14. As a user, when conversation mode is OFF, I want all of this dormant (no TTS, no auto-send unless I set `directSend` independently, no mic re-open), so that the default typing-first experience is unchanged.

## Resolved decisions (the three launch open questions)

The three open questions this spec launched with are RESOLVED (they shaped the task boundaries; the build detail now lives in the tasks):

1. **`say` registration surface → DUAL**, mirroring `attach_file` (server session pool `customTool` + the `@wherever-dev/pi` extension), so behaviour is uniform across session types. This adds an `extension/` change and a `"@wherever-dev/pi"` changeset.
2. **`say` UI treatment → FIRST-CLASS "spoken:" card** (not a generic tool card), exempt from `hideTools` like `attach_file`, so divergence between the short spoken reply and the full written one is easy to spot. The full written reply always remains present.
3. **Hands-free loop → BROWSER-engine only** for auto mic re-open (streaming recognition restarts cleanly); the CLOUD engine (explicit hold-to-talk / tap-to-toggle) falls back to RE-FOCUSING the composer, no auto-record.

## Out of Scope

- **Server-side / cloud TTS.** v1 uses the browser `SpeechSynthesis` API only; a server-rendered voice is a future item.
- **Model-driven auto-summarisation of the full reply client-side.** The short spoken reply comes from the agent's explicit `say` call, NOT from the client summarising the last message (that is fuzzy and unreviewable — the whole point is an agent-authored, spottable short form).
- **Replacing / hiding the full written reply.** The full message always stays in the transcript; conversation mode only changes emphasis and adds a spoken layer.
- **A new WS message type or chat role** for spoken replies — explicitly avoided (the removed `file_attachment` bridge-marker anti-pattern).
- **VSCode companion + `site/`** — this is a `web/` (+ `extension/` for the `say` registration) feature.

> Tasked 2026-07-24 into `work/tasks/backlog/` (5 vertical slices: `say-tool-dual-registration`, `conversation-mode-knobs-registry`, `say-tool-tts-and-card` (blockedBy both), `collapse-long-replies` (blockedBy the registry + the say card, serialized to avoid a chat-list merge conflict), `hands-free-mic-reopen` (blockedBy the registry)). The Implementation/Testing detail that used to live here now lives in those tasks (what to build); this spec keeps only its durable framing + the resolved open questions.

## Further Notes

- Related existing surfaces reused, not re-invented: `SpeechButton.svelte` (`directSend`/`engine`/`locale`, the `wherever-speech-*` localStorage keys), `web/src/lib/core/beep.ts` + the `isStreaming` true→false settle edge in `web/src/lib/wherever.ts`, the `attach_file` dual-registration pattern (`server/src/attach-file-tool.ts` + `extension/src/index.ts`), and the tool-call-driven UI surfacing in `ChatMessageList.svelte`.
- Changeset rule (`AGENTS.md`): `web/` + `server/` changes → `"wherever-dev": <bump>`. The `say` registration in `extension/` additionally needs `"@wherever-dev/pi": <bump>`. Never bump `@wherever-dev/web`.
