---
title: Conversation-mode knobs registry + master toggle + settings UI
slug: conversation-mode-knobs-registry
spec: conversation-mode
blockedBy: []
covers: [1, 2, 3, 9, 14]
---

## What to build

A named PRESET of individually-configurable conversation-mode knobs, persisted in the existing web config, plus a "Conversation Mode" master toggle and per-knob settings UI. The mode is just a saved BUNDLE of independent knobs the user configures.

Knobs (each with exactly ONE canonical persisted home — no duplicate keys):

- `conversationMode: boolean` — the master toggle; when true, the knobs below take effect.
- `autoSendOnSpeechEnd: boolean` — this is the EXISTING `directSend` (send-on-speech-end) surfaced as a conversation-mode knob. Do NOT fork a second flag; reuse the existing `wherever-speech-direct-send` persistence so the two are the SAME underlying value.
- `speakReplies: boolean` — read the `say` payload via `SpeechSynthesis` (consumed by the `say-tool-tts-and-card` task).
- `collapseLongReplies: boolean` — de-emphasise/collapse long written replies (consumed by the `collapse-long-replies` task).
- `micReopensAfterReply: boolean` — hands-free loop (consumed by the `hands-free-mic-reopen` task).

Persist each knob in the established pattern (the `wherever-config` localStorage entry and/or the `wherever-speech-*` keys — reuse, do not invent a parallel store). The master `conversationMode` toggle GATES the dependent knobs: when off, everything is dormant and behaviour matches today's typing-first default.

**One exception to the gate: `autoSendOnSpeechEnd` (= `directSend`) is NOT suppressed by `conversationMode` being off.** Because it is the SAME existing flag, it must keep its standalone effect when the mode is off (a user who set `directSend` today still gets auto-send with conversation mode off — story 14). So `conversationMode` flipping ON is what BUNDLES `autoSendOnSpeechEnd` on alongside the others, but `conversationMode` being OFF does NOT force it off. The purely-conversation knobs (`speakReplies`, `collapseLongReplies`, `micReopensAfterReply`) ARE dormant when the mode is off. Surface the master toggle prominently (e.g. the top bar / connection settings) and the individual knobs in settings so the user edits each independently.

This task owns the registry + toggle + persistence + gating ONLY. The consumers (TTS, card, collapse, hands-free) are separate tasks that READ these knobs.

## Acceptance criteria

- [ ] Each knob persists to and loads from its single canonical localStorage home; a reload/session-switch restores the configured values.
- [ ] `autoSendOnSpeechEnd` is the SAME underlying flag as the existing `directSend` (`wherever-speech-direct-send`) — no forked second key; toggling one is reflected by the other.
- [ ] The master `conversationMode` toggle gates the purely-conversation knobs (`speakReplies`, `collapseLongReplies`, `micReopensAfterReply`): with it OFF, none has effect (no TTS, no mic re-open, no collapse) and behaviour matches today's typing-first default.
- [ ] `autoSendOnSpeechEnd` (= `directSend`) is NOT suppressed by `conversationMode` being off: a standalone-set `directSend` still auto-sends with the mode off (today's behaviour is not regressed). Flipping `conversationMode` ON bundles it on; flipping it OFF does not force it off.
- [ ] A "Conversation Mode" toggle is present in the web UI and flips the configured bundle ON at once; the individual knobs are each editable in settings.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style): unit tests that each knob persists/loads from its single canonical home, that the master toggle gates the dependent knobs, and that `autoSendOnSpeechEnd` and `directSend` share one key (no forked second key).

## Blocked by

- None — can start immediately.

## Prompt

> Goal: add a conversation-mode knobs registry to the Wherever web dashboard (`web/`) — a named preset of independent boolean knobs persisted in the existing config, with a master "Conversation Mode" toggle that flips the bundle on and gates the dependent knobs. This task is the REGISTRY + TOGGLE + PERSISTENCE ONLY; the behaviours the knobs drive (TTS, the `say` card, collapse-long-replies, hands-free mic re-open) are separate tasks that READ these knobs.
>
> FIRST, drift-check against reality: confirm the existing persistence pattern this task reuses — the speech prefs (`directSend`/`engine`/`locale`) persist under `wherever-speech-*` localStorage keys in the speech button component, and the app config (beep prefs etc.) persists in a single `wherever-config` localStorage entry via a `getConfig()`/`saveConfig()` pair in the web lib. Reuse whichever fits each knob; do NOT introduce a parallel store. If these have changed, reconcile before building.
>
> Where to look (by concept, not brittle paths): the speech button component owns `directSend`/`engine`/`locale` and their `wherever-speech-*` keys; the web lib module owns `getConfig`/`saveConfig` over `wherever-config` and the reactive stores (see how `beepDefault` is done as a persisted-flag + reactive-store pattern to mirror).
>
> Key decisions already made (do not re-litigate): `autoSendOnSpeechEnd` IS the existing `directSend` surfaced as a conversation knob — reuse `wherever-speech-direct-send`, do NOT fork a second flag (coherence). Exactly ONE canonical persisted home per knob. The master `conversationMode` toggle gates the dependent knobs; when off, everything is dormant and the default typing-first experience is unchanged. The knobs are: `conversationMode`, `autoSendOnSpeechEnd` (=directSend), `speakReplies`, `collapseLongReplies`, `micReopensAfterReply`.
>
> Done = the knobs persist/load from single canonical homes, the master toggle gates them, `directSend`/`autoSendOnSpeechEnd` share one key, and the tests above pass. Changeset per AGENTS.md: web-only → `"wherever-dev": patch` (never `@wherever-dev/web`).
