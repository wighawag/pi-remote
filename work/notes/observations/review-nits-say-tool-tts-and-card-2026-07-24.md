---
title: review-gate non-blocking nits for 'say-tool-tts-and-card' (Gate 2 approve)
date: 2026-07-24
status: open
reviewOf: say-tool-tts-and-card
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'say-tool-tts-and-card' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- AC #5 literally asks for Svelte COMPONENT tests (render + mocked window.speechSynthesis), but the tests pin the pure-logic seam (extractSayText/speakUtterance) instead. Ratify this deviation.
  (web/vitest.config uses environment:node with NO jsdom/testing-library by design (only core/* is tested). A literal component test is not achievable in this harness; the agent extracted logic to core/speak.ts mirroring media-kind.test.ts/beep and tested it. Justified and recorded in the changeset.)
- New user-visible error affordance: a say tool call with isError renders a 🔇 'Could not speak' rose card. This is not specified by the task. Ratify.
  (ChatMessageList.svelte isSayTool branch renders an error variant; parseToolMessage/effect skip speaking on error. Reasonable, but a net-new UI surface the task did not name.)
- Mark-before-gate: a say message that settles while speakReplies is OFF is added to spokenSayIds and will NEVER be spoken even if the user later turns speakReplies ON. Confirm this is the intended default.
  ($effect adds msg.id before the isKnobActive check, so only says arriving AFTER the knob is on are spoken. Matches 'no utterance fires when off' and avoids re-speaking history on toggle; a sensible default worth ratifying.)
- Cross-task interaction: because speakReplies is a GATED knob, TTS also requires the master conversationMode to be on (isKnobActive returns knobs.conversationMode && knobs.speakReplies). Ratify this coupling.
  (conversation-mode.ts isKnobActive gates speakReplies on the master toggle; this is coherent with the knobs-registry dependency and recorded in the changeset, but means speakReplies alone does not enable TTS.)
