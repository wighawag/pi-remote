# Plan: Fix queued message deleted on unqueue (should return to input)

**Status:** Planned, NOT implemented. Written 2026-06-14.
**Issue:** When a queued message is unqueued, it is deleted instead of being
pasted back into the editable text input field.

## Evidence (exact, from real file)

`web/src/lib/components/ChatInput.svelte`:

- State:
  ```ts
  let queuedText = $state<string | null>(null);
  let queuedTextBackup = $state<string | null>(null);
  ```
- When sending while streaming, the message is queued AND backed up:
  ```ts
  if (streaming) {
      queuedText = messageToSend;
      queuedTextBackup = messageToSend;
      attachments = [];
  }
  ```
- The bug is in `handleUnqueue()`:
  ```ts
  function handleUnqueue() {
      queuedText = null;
      text = '';                 // <-- wipes the message instead of restoring it
      setTimeout(() => textarea?.focus(), 0);
  }
  ```
- There is also a reactive effect that mirrors queued text into the box while
  queued:
  ```ts
  $effect(() => {
      if (queuedText) {
          text = queuedText;
      }
  });
  ```
  Note: because this effect only runs when `queuedText` is truthy, setting
  `queuedText = null` does not by itself clear `text`; the explicit `text = ''`
  in `handleUnqueue` is what destroys the content. `queuedTextBackup` already
  holds the message but is currently unused on unqueue.

## Root cause

`handleUnqueue()` clears `text` to `''`. The backup (`queuedTextBackup`) that
exists specifically to preserve the message is never read.

## Fix

In `handleUnqueue()`, restore the message into the editable input instead of
clearing it:

```ts
function handleUnqueue() {
    const restore = queuedTextBackup ?? queuedText ?? '';
    queuedText = null;
    text = restore;            // put it back so the user can edit/resend
    queuedTextBackup = null;
    setTimeout(() => {
        textarea?.focus();
        // optional: move caret to end
        if (textarea) textarea.selectionStart = textarea.selectionEnd = text.length;
    }, 0);
}
```

### Edge cases to handle
- **Attachments**: when a message is queued, `attachments = []` is run, so
  attachments are already dropped at queue time. Unqueue cannot fully restore
  attachments (their paths were folded into `messageToSend` text only if they
  had uploaded successfully). Decide:
  - Minimal fix: restore just the text (attachments stay gone). Acceptable and
    matches current queue behaviour.
  - Better (optional, larger): also preserve and restore the attachment list.
    Out of scope for the minimal fix; note as a follow-up.
- **The mirroring `$effect`**: confirm that after unqueue (`queuedText = null`),
  the effect does not immediately re-overwrite `text`. It won't, because the
  effect body is guarded by `if (queuedText)`. Verify no other effect resets
  `text`.
- **Auto-send effect**: `$effect(() => { if (!streaming && queuedText) {...} })`
  auto-sends when streaming stops. There is a race: if the user clicks Unqueue
  exactly as streaming stops, the auto-send may fire first. Acceptable; the fix
  doesn't worsen it. Optionally guard by checking a local "unqueuing" flag.

## Acceptance / verification
- Queue a message while the agent is streaming; click **Unqueue**; the message
  text reappears in the input, focused and editable, and is NOT sent.
- Editing then sending works normally.
- Queue + let it auto-send on stream end still works (no regression).

## Risk / notes
- Tiny, web-only, single-function change.
- Changeset: `"wherever-dev": patch`.
