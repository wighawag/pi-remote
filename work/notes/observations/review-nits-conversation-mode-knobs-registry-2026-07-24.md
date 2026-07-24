---
title: review-gate non-blocking nits for 'conversation-mode-knobs-registry' (Gate 2 approve)
date: 2026-07-24
status: open
reviewOf: conversation-mode-knobs-registry
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'conversation-mode-knobs-registry' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: setConversationModeBundle(on) is a thin alias for setConversationMode(on) rather than a distinct bundling routine. It relies on the design that flipping the master does NOT mutate the other knobs (they keep configured values and gate via isKnobActive). Is that the intended semantic for the top-bar toggle?
  (web/src/lib/wherever.ts setConversationModeBundle just calls setConversationMode; matches bundleOn() in core/conversation-mode.ts and spec story 2 (preset over configured knobs). No Decisions block in commit body, so flagging for ratification.)
- Ratify: the Connection Settings panel exposes conversationMode/speakReplies/collapseLongReplies/micReopensAfterReply as checkboxes but NOT autoSendOnSpeechEnd, whose control stays as Direct Send in Speech Settings (a note points there). Acceptable that this shared knob is edited only via SpeechButton, not duplicated in the conversation panel?
  (ConnectionSettings.svelte lists 4 knobs; autoSendOnSpeechEnd omitted deliberately to avoid a second control on the same wherever-speech-direct-send key. Coherent but user-visible; not recorded as a decision.)
- Ratify UI default: the master toggle is a 💬/🗣️ emoji button in the ChatMessageList top bar labelled Conversation: On/Off. Is that placement/affordance the intended prominent surface?
  (ChatMessageList.svelte toggleConversationMode; spec asked to surface the master toggle prominently. Non-obvious presentation choice.)
