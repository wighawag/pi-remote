---
"wherever-dev": patch
---

Add `work/specs/proposed/conversation-mode.md`: a spoken back-and-forth "conversation
mode" that is a PRESET over individually-configurable speech knobs (reusing the
existing `directSend` send-on-speech-end), plus a self-contained `say` tool (the
`attach_file` pattern) so the agent emits a SHORT spoken reply — read aloud via
browser `SpeechSynthesis` — IN ADDITION to its full written answer, letting the
human hear something concise and spot when it misrepresents the detail. Staged in
`specs/proposed/` with `needsAnswers: true` (three open questions: `say` registration
surface, `say` UI treatment, hands-free/engine interaction). No runtime code changed.
