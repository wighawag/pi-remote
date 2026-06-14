# Plan: Search-mode UX improvements (composer + top bar)

**Status:** Planned, NOT yet implemented. Written 2026-06-14.
**Builds on:** `docs/plan-search-mode.md` (shipped in commit `242b652`). That
delivered the working feature: `searchFolder` / `searchCreateRemote` config, a
basic autofocused top-bar search input, `runSearch()`, the `web-search` skill,
auto-seeded `AGENTS.md`, and the `pisearch` CLI. This plan is purely the UX
follow-up.

## Why

The shipped search input is a single-line `<input>` bolted into the top bar. It
works, but it is cramped for real queries, has no mic, and does not match the
comfortable multi-line composer used for chat. The user proposed several
improvements; this plan reshapes them into one coherent design rather than four
separate widgets.

## The core decision

The chat composer (`web/src/lib/components/ChatInput.svelte`) ALREADY is the
comfortable input the user wants for search: auto-growing multi-line textarea,
Enter-to-send with Shift+Enter for newline (toggleable), a mic
(`SpeechButton`, `bind:text`), file attach, and collapse. **Reuse it as the
search composer instead of building a second growing input in the top bar.** A
parallel mini-composer would duplicate autosize, key handling, and mic, and
would drift from the real one over time.

So the design is: **one smarter composer + a context-aware single top bar.** Not
a second stacked bar, not two simultaneous search inputs.

## What the user proposed, and the verdict on each

1. **A second bar stacked above the top bar showing current folder/agent.**
   REJECTED. The top bar already shows folder + model when a session is loaded;
   a second permanent row wastes vertical space (worst on phone, the primary
   target). The real need (clarity between "search" and "current session") is
   met by making the *one* top bar context-aware.
2. **When no session is loaded, the bottom input becomes a search input.**
   ADOPTED, reshaped. Do not show two search inputs at once. When no session is
   active, the bottom composer IS the search composer (Enter -> `runSearch`).
   When a session is active, it is the message composer as today.
3. **Keep the mic in the top bar.** ADOPTED via the composer. The mic lives in
   the composer, so search-by-voice works wherever the composer is the search
   input. (No separate top-bar mic; that would duplicate `SpeechButton`.)
4. **On focus, grow to multi-line with Shift+Enter like the message input.**
   ADOPTED. This is exactly what `ChatInput` already does; reusing it gives this
   for free instead of reimplementing it in the top bar.

## Current structure (verified against real files, 2026-06-14)

- `ChatInput.svelte`: owns `text`, computes `effectivelyDisabled` from
  `disabled || readOnly || !sessionInfo.sessionId || queuedText`, calls
  `sendMessage` / `createSession` / `clearMessages` / `leaveSession` directly,
  hosts `SpeechButton bind:text onSend`. It is hard-wired to "there is an active
  session." It must become mode-aware to also serve search (no session).
- `+page.svelte`: single top bar with the search `<form>` added in the prior
  slice (visible when `connected && searchFolder`), plus folder/model selector
  shown only when a session is loaded. Bottom is `<ChatInput>` with
  `disabled={!connected || readOnly || !sessionInfo.sessionFile}`.
- `runSearch(query)` already exists in `wherever.ts`.

## Design

### Composer modes

Give `ChatInput` an explicit mode prop instead of inferring everything from
session presence:

- `mode: 'chat' | 'search'` (or a `onSubmit` + `submitLabel` + `placeholder`
  set, which is cleaner and keeps the component generic).
- In **search** mode: submit calls `runSearch(text)` (not `sendMessage`); it is
  enabled even with no active session; placeholder "Search the web..."; submit
  button label "Search"; file-attach hidden; slash-command handling skipped;
  `effectivelyDisabled` drops the `!sessionInfo.sessionId` term and instead
  requires `connected && searchFolder`.
- In **chat** mode: unchanged behaviour.

Prefer prop injection (`onSubmit`, `placeholder`, `submitLabel`, `canSubmit`,
`showAttach`) over a hardcoded `mode` enum so the component stays dumb. The mic
stays internal (`bind:text`) and works in both modes for free.

### Page wiring (single top bar, context-aware)

- **No active session + search configured:** the bottom composer is the search
  composer (autofocused). The top bar is minimal (logo/menu + a short
  "Search the web" hint or nothing). This replaces the cramped top-bar
  `<input>`; that inline input is REMOVED.
- **Active session:** bottom composer is the chat composer (today). Top bar
  shows folder/model as today, PLUS a compact search affordance (a 🔍 button)
  that, when search is configured, lets the user start a new search without
  leaving the session. Two options for that affordance:
  - a) a small button that focuses/opens a transient search composer, or
  - b) simplest: a 🔍 button that calls a "start search" action which leaves the
    session and drops to the search empty-state (composer becomes search).
  Lean: (b) for v1 (less surface area); revisit (a) if switching feels heavy.

### Top bar: no second row

Keep exactly one top-bar row. Context-aware contents only. Reject the stacked
bar.

## Implementation outline

1. `ChatInput.svelte`: add optional props
   `{onSubmit?, placeholder?, submitLabel?, showAttach?, searchMode?}`.
   - When `searchMode`, `effectivelyDisabled` uses `connected && searchConfigured`
     instead of `sessionInfo.sessionId`; `handleSend` routes to `onSubmit(text)`;
     skip slash commands and attachments; keep mic + autosize + Shift+Enter.
2. `+page.svelte`:
   - Remove the inline top-bar `<input>` search form added previously.
   - Render the bottom `<ChatInput>` in search mode when
     `connected && searchFolder && !sessionInfo.sessionFile`, passing
     `onSubmit={(q) => runSearch(q)}`.
   - Add a compact 🔍 affordance in the top bar (chosen option from above) when
     `searchFolder` is set and a session is active.
   - Keep autofocus behaviour (composer focuses itself when enabled, already in
     `ChatInput`).
3. Verify: `pnpm --filter ./web check` clean; manual check on a narrow (phone)
   viewport that only ONE search input shows at a time and the mic works in
   search mode.
4. Changeset: `"wherever-dev": minor` (web-only).

## Open questions to confirm before building

- Top-bar search affordance for the active-session case: option (a) transient
  composer vs (b) drop-to-empty-state. (Plan leans b for v1.)
- Should search mode keep the "Press Enter to send" toggle and Collapse, or are
  those chat-only? (Lean: keep them; they are harmless and consistent.)
- Should a search submitted while a session is active reuse the current view or
  always spawn a fresh session in the search folder? (Today `runSearch` always
  spawns fresh; keep that.)

## Non-goals

- No second/stacked top bar.
- No duplicate search inputs visible simultaneously.
- No reimplementation of mic / autosize / key handling outside `ChatInput`.
