---
title: Conversation mode — a spoken back-and-forth preset with a short reviewable spoken reply
slug: conversation-mode
needsAnswers: true
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `CONTEXT.md` + `docs/` (decisions) + the code; remaining work: the tasks sliced from this spec.

<!-- open-questions -->
<!--
  TRANSIENT BLOCK — stripped by the apply rung on full resolution.
-->

## Open questions

1. **`say` tool registration surface.** `attach_file` is registered in TWO places (`server/src/attach-file-tool.ts` for server-side sessions + `extension/src/index.ts` for CLI-bridge sessions) so it exists in every session type. Should `say` follow the SAME dual registration, or is v1 scoped to server-side (web-frontend) sessions only? (Leaning: dual, to match `attach_file` and keep behaviour uniform — but confirm, since it adds an `extension/` change + a `@wherever-dev/pi` changeset.)
2. **Does `say` need a special UI card, or is a normal tool card enough for v1?** The spoken text is already visible as the tool's argument; TTS reads it. A dedicated "spoken:" pill (distinct from the full reply) is nicer for spotting divergence but is polish. Confirm whether v1 renders `say` as a first-class card (like `attach_file`) or an ordinary tool card that TTS happens to read.
3. **Hands-free mic re-open + auto-send interaction on the CLOUD engine.** `micReopensAfterReply` + `autoSendOnSpeechEnd` compose cleanly for the browser (streaming) engine. For the cloud (hold-to-talk / tap-to-toggle) engine, "auto re-open the mic" is less obvious (there is an explicit record gesture). Is hands-free loop v1 **browser-engine only**, falling back to "just re-focus the composer" on cloud?

<!-- /open-questions -->

## Problem Statement

Today the web UI is a typing-first chat: the user types (or dictates via `SpeechButton`) and reads the agent's full reply. There is already a speech-to-text path with a **send-on-speech-end** knob (`directSend` in `web/src/lib/components/speech/SpeechButton.svelte`), so speaking TO the agent works. But:

- The agent's reply is its **full last message** — often long, detailed, code-heavy — which is a poor thing to speak aloud or glance at during a hands-busy spoken exchange.
- There is no "conversation" posture: no bundling of the speech knobs into a single mode the user can flip on, and no way for the agent to emit a SHORT spoken reply distinct from its full written answer.

The user wants a **conversation mode**: a spoken back-and-forth where the user speaks and the agent replies, but the SPOKEN reply is a short, reviewable summary the agent produces on purpose (via a tool call) — not the full last message — so the human hears something short and can SEE when the short version misrepresents the long one. Conversation mode is a **preset over a set of knobs** the user configures; toggling the mode activates that configured set. `directSend` (send-on-speech-end) is one such knob that already exists.

Scope is `web/` (a knobs registry + mode toggle + TTS + hands-free loop wiring) plus a self-contained `say` tool (registration surface per Open Question 1). No new WS message type — `say` rides the existing `tool_start`/`tool_end` stream exactly like `attach_file`.

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
7. As a user, I want a **hands-free knob** that re-opens the mic after the agent finishes speaking, so that I can carry on the conversation without tapping (Open Question 3 scopes which engine this covers in v1).
8. As a user, I want a **speak-replies knob** (browser `SpeechSynthesis`) that reads the `say` payload aloud, with graceful no-op when the browser has no TTS, so that voice output is optional and degrades safely.
9. As a user, I want conversation-mode knobs to **persist** (in the existing `wherever-config` / `wherever-speech-*` localStorage), so that my configured mode survives reloads and session switches.
10. As the agent, I want a `say` tool whose description tells me to use it, WHEN CONVERSATION MODE IS ACTIVE, to provide a short spoken-form reply IN ADDITION to my normal written answer, so that the human hears a concise version they can sanity-check.
11. As a user, I want the `say` spoken text surfaced in the chat (at minimum as its tool argument; ideally a distinct "spoken:" affordance) so that I can visually compare the short spoken reply against the full written one.
12. As a maintainer, I want the `say` tool to be **self-contained** (validate the argument, return a normal tool result, touch no bridge/side-channel), exactly like `attach_file`, so that it works identically in server-side and CLI-bridge sessions.
13. As a maintainer, I want conversation mode to introduce **no new WS message type and no new chat role** — the `say` affordance rides the existing `tool_start`/`tool_end` stream — so that the protocol surface is unchanged.
14. As a user, when conversation mode is OFF, I want all of this dormant (no TTS, no auto-send unless I set `directSend` independently, no mic re-open), so that the default typing-first experience is unchanged.

### Autonomy notes (the two gate axes)

- **`humanOnly`:** omitted — this is ordinary product/UX work with no release/secrets/security nature; a human can review via the normal position gate (birthed in `tasks/backlog/`).
- **`needsAnswers: true`:** set — three open questions (above) about the `say` registration surface, the `say` UI treatment, and the hands-free/engine interaction must be answered before this is cleanly taskable. They change task boundaries (whether `extension/` is touched, whether a first-class card task exists, whether the hands-free task is browser-only).

## Implementation Decisions

- **`say` tool (the `attach_file` mirror).**
  - Self-contained: `execute` validates `text` (non-empty string) and returns a normal tool result carrying the text in `details` (e.g. `{ text }`); it reads no files and emits NO side channel. Model-facing result is a short confirmation string.
  - Description/guidelines instruct: use ONLY to provide a short spoken-form reply while a spoken conversation is active, IN ADDITION to the normal written answer; keep it to one or two sentences; the full detail stays in the written message.
  - Registration surface: per **Open Question 1** (dual like `attach_file`, or server-side only for v1).
- **Knobs registry (a named preset).** A small config object (persisted in `wherever-config` and/or the existing `wherever-speech-*` keys — reuse the established pattern) with at least:
  - `conversationMode: boolean` — the master toggle; when true, the knobs below take effect.
  - `autoSendOnSpeechEnd: boolean` — the existing `directSend`, surfaced as a conversation-mode knob (do NOT fork a second flag; reuse/rename the existing one — coherence).
  - `speakReplies: boolean` — read the `say` payload via `SpeechSynthesis`.
  - `collapseLongReplies: boolean` — de-emphasise/collapse long written replies (never delete).
  - `micReopensAfterReply: boolean` — hands-free loop (engine scope per Open Question 3).
  The "Conversation Mode" toggle is a saved BUNDLE of these; the user edits each independently in settings. There is exactly ONE canonical persisted home per knob (no duplicate keys).
- **TTS.** Browser `window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))`, fired on the `say` tool call when `speakReplies` is on. No-op (feature-detect) when unavailable. Reuse the speech locale where sensible for the utterance `lang`.
- **Rendering.** The `say` call surfaces in `ChatMessageList.svelte`. v1 minimum: its text is visible (tool argument). Ideal (per Open Question 2): a distinct "spoken:" pill so divergence from the full reply is easy to spot. Rendered so the FULL written reply always remains present.
- **Hands-free loop.** When `micReopensAfterReply` is on, after the agent settles (the same `isStreaming` true→false edge the beep already uses in `web/src/lib/core/beep.ts`) and any TTS finishes, re-open the mic (browser engine) or re-focus the composer (cloud engine fallback), per Open Question 3.
- **No protocol change.** `say` rides `tool_start`/`tool_end`; no new WS message type, no new chat role, no bridge marker (the removed `file_attachment` design is the anti-pattern to avoid — see CONTEXT.md).

## Testing Decisions

- **`say` tool** — unit: empty/blank `text` returns an error result; a valid `text` returns a normal (non-error) result carrying the text in `details`; the tool touches no filesystem/side channel.
- **Knobs registry** — unit: each knob persists to and loads from its single canonical localStorage home; the master `conversationMode` toggle gates the dependent knobs; `autoSendOnSpeechEnd` is the SAME underlying flag as the existing `directSend` (no forked second key).
- **TTS** — component: with `speakReplies` on, a `say` tool call triggers a `SpeechSynthesis` utterance (mock `window.speechSynthesis`); with it off, no utterance; feature-absent browser is a graceful no-op.
- **Rendering** — component: a `say` call surfaces its spoken text in the chat while the full written reply remains present (never replaced/deleted); `collapseLongReplies` collapses but does not remove the long reply.
- **Off-state** — with `conversationMode` off, no TTS fires, the mic does not re-open, and behaviour matches today's typing-first default.

## Out of Scope

- **Server-side / cloud TTS.** v1 uses the browser `SpeechSynthesis` API only; a server-rendered voice is a future item.
- **Model-driven auto-summarisation of the full reply client-side.** The short spoken reply comes from the agent's explicit `say` call, NOT from the client summarising the last message (that is fuzzy and unreviewable — the whole point is an agent-authored, spottable short form).
- **Replacing / hiding the full written reply.** The full message always stays in the transcript; conversation mode only changes emphasis and adds a spoken layer.
- **A new WS message type or chat role** for spoken replies — explicitly avoided (the removed `file_attachment` bridge-marker anti-pattern).
- **VSCode companion + `site/`** — this is a `web/` (+ possibly `extension/`) feature.

## Further Notes

- Related existing surfaces to reuse, not re-invent: `SpeechButton.svelte` (`directSend`/`engine`/`locale`, the `wherever-speech-*` localStorage keys), `web/src/lib/core/beep.ts` (the `isStreaming` true→false settle edge), the `attach_file` dual-registration pattern (`server/src/attach-file-tool.ts` + `extension/src/index.ts`), and the tool-call-driven UI surfacing in `ChatMessageList.svelte`.
- Changeset rule (`AGENTS.md`): `web/` + `server/` changes → `"wherever-dev": <bump>`. If `say` is ALSO registered in `extension/` (Open Question 1), that part additionally needs `"@wherever-dev/pi": <bump>`. Never bump `@wherever-dev/web`.
