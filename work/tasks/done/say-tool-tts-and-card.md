---
title: say tool web surfacing — first-class "spoken:" card + SpeechSynthesis TTS
slug: say-tool-tts-and-card
spec: conversation-mode
blockedBy: [say-tool-dual-registration, conversation-mode-knobs-registry]
covers: [5, 8, 11]
---

## What to build

The web-side surfacing of the `say` tool call in the chat, plus browser TTS of its payload. Driven entirely by the tool CALL over the already-streamed `tool_start`/`tool_end` — no protocol change.

1. **First-class "spoken:" card.** Render a `say` tool call as a first-class card (mirroring the `attach_file` first-class treatment), showing the spoken text with a distinct 🔊 "spoken:" affordance so the user can visually compare the short spoken reply against the full written one. Exempt it from the `hideTools` collapse like `attach_file` is. The FULL written reply always remains present in the transcript — the `say` card is ADDITIVE, never a replacement (never delete/hide the full reply).
2. **TTS on the call.** When `speakReplies` is on (from the conversation-mode knobs registry), fire `window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))` on the `say` tool call, using the speech locale for the utterance `lang` where sensible. Feature-detect: when `speechSynthesis` is unavailable, no-op gracefully. When `speakReplies` is off, no utterance fires.

## Acceptance criteria

- [ ] A `say` tool call surfaces its spoken text in the chat as a first-class "spoken:" card (distinct affordance), exempt from `hideTools`, while the full written reply remains present (never replaced or deleted).
- [ ] With `speakReplies` ON, a `say` tool call triggers exactly one `SpeechSynthesis` utterance carrying the text; with it OFF, no utterance fires.
- [ ] A browser with no `speechSynthesis` is a graceful no-op (no throw).
- [ ] The utterance `lang` reflects the configured speech locale where sensible.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style): a component test that a `say` call renders its spoken text while the full reply is still present; a component test mocking `window.speechSynthesis` that a `say` call fires an utterance with `speakReplies` on and none with it off; a feature-absent no-op check.

## Blocked by

- `say-tool-dual-registration` — the `say` tool must exist and stream `tool_start`/`tool_end` before the web can surface it.
- `conversation-mode-knobs-registry` — the `speakReplies` knob this reads is defined there.

## Prompt

> Goal: surface the `say` tool call in the Wherever web dashboard (`web/`) as a first-class "spoken:" card AND speak its payload via the browser `SpeechSynthesis` API when the `speakReplies` knob is on. Everything is driven by the tool CALL over the existing `tool_start`/`tool_end` stream — no new WS message type, no new chat role.
>
> FIRST, drift-check against reality: confirm (a) the `say` tool now exists and its call carries `text` (see the `say-tool-dual-registration` task in `tasks/done/`), (b) the `speakReplies` knob exists in the conversation-mode knobs registry (see `conversation-mode-knobs-registry` in `tasks/done/`), and (c) the chat message list still renders `attach_file` as a first-class card exempt from `hideTools` (the pattern to mirror). If any dependency landed differently than assumed, route to needs-attention rather than building on the stale premise.
>
> Where to look (by concept, not brittle paths): the chat message list component owns tool-card parsing and the `attach_file` first-class-card branch — add a sibling branch for `say`. The speech locale lives with the speech prefs (`wherever-speech-locale`). The conversation-mode knobs (incl. `speakReplies`) live in the registry from the dependency task.
>
> Key decisions already made (do not re-litigate): Open Question 2 resolved to a FIRST-CLASS card with a distinct "spoken:" pill (not a generic tool card) so divergence from the full reply is spottable, exempt from `hideTools` like `attach_file`. The full written reply ALWAYS stays in the transcript — the `say` card is additive. TTS is browser `SpeechSynthesis` only (server-side/cloud TTS is out of scope), fires on the `say` call when `speakReplies` is on, feature-detected to a graceful no-op, using the speech locale for `lang`. Do NOT client-side-summarise the full reply — the short text comes ONLY from the agent's explicit `say` call.
>
> Done = a `say` call renders a first-class "spoken:" card with the full reply still present, TTS fires only when `speakReplies` is on (and no-ops when unavailable), and the component tests above pass. Changeset per AGENTS.md: web-only → `"wherever-dev": patch` (never `@wherever-dev/web`).
