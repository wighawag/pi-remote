---
title: collapseLongReplies knob — de-emphasise long written replies (never delete)
slug: collapse-long-replies
spec: conversation-mode
blockedBy: [conversation-mode-knobs-registry, say-tool-tts-and-card]
covers: [6]
---

## What to build

When conversation mode is on and the `collapseLongReplies` knob is set, de-emphasise/collapse long written assistant replies in the chat so the short spoken summary is the focus and the transcript stays glanceable. The full reply is NEVER deleted or removed — it is only collapsed/de-emphasised and can always be expanded/read. When the knob is off (or conversation mode is off), replies render exactly as today.

## Acceptance criteria

- [ ] With `collapseLongReplies` ON (and conversation mode on), a long written assistant reply is collapsed/de-emphasised but remains fully present and expandable — never removed or truncated destructively.
- [ ] With the knob OFF (or conversation mode off), long replies render exactly as today (no collapse).
- [ ] The collapse is a display concern only — the underlying transcript/message content is unchanged.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style): a component test that with the knob on a long reply collapses but the full text is still reachable (not deleted), and with it off the reply renders normally.

## Blocked by

- `conversation-mode-knobs-registry` — the `collapseLongReplies` knob is defined there.
- `say-tool-tts-and-card` — serialized after it because both edit the chat message list component (avoid a merge conflict per the tasking merge-orthogonality rule).

## Prompt

> Goal: add the `collapseLongReplies` behaviour to the Wherever web dashboard (`web/`) — when conversation mode + the knob are on, collapse/de-emphasise long written assistant replies so the short spoken summary is the focus, WITHOUT ever deleting the full reply.
>
> FIRST, drift-check against reality: confirm the `collapseLongReplies` knob exists in the conversation-mode knobs registry (see `conversation-mode-knobs-registry` in `tasks/done/`) and that the chat message list component still renders assistant replies with an existing expand/collapse affordance to reuse (see the `say-tool-tts-and-card` task's changes in `tasks/done/`). If either landed differently, route to needs-attention rather than building on the stale premise.
>
> Where to look (by concept, not brittle paths): the chat message list component owns assistant-reply rendering and already has expand/collapse machinery for tool cards — reuse that idiom for long replies. The knob comes from the conversation-mode knobs registry.
>
> Key decisions already made (do not re-litigate): this NEVER deletes or hides the full reply — it only collapses/de-emphasises it, and it must always be expandable/readable (explicitly out of scope: replacing/hiding the full written reply). It is a display concern only; the transcript content is untouched. Gated by conversation mode + the `collapseLongReplies` knob; off by default.
>
> Done = long replies collapse (but stay fully present/expandable) when the knob is on and render normally when off, and the component tests above pass. Changeset per AGENTS.md: web-only → `"wherever-dev": patch` (never `@wherever-dev/web`).
