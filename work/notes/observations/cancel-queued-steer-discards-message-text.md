---
title: Cancelling the steer queue silently destroys the user's typed text (not returned to the composer), and the cancelled bubbles linger until reload
type: observation
status: spotted
spotted: 2026-07-31
---

# "Cancel queued" throws away text the user may still want

## What was seen

With a turn in flight, a submit becomes a mid-stream steer that pi holds in its queue (`server/src/session-pool.ts` `getSteeringQueue`/`cancelSteerQueue`, surfaced to the client as `queue_update` → `pendingSteering`). The session-level "Cancel queued" button (`web/src/lib/components/ChatMessageList.svelte:2344-2356` → `wherever.ts:710 cancelSteer` → `client.ts:2173 cancelSteer` → server `cancel_steer` → `AgentSession.clearQueue()`) retracts the whole queue.

Two things follow from that cancel, neither of them intended UX:

1. **The typed text is gone.** Nothing puts it back in the composer. The retraction path is purely a delete: the client optimistically empties `pendingSteering`, the server's fresh `queue_update` confirms an empty queue, and the text exists nowhere the user can reach it. The machinery to hand text back to the composer already exists and is used by fork (`composerPrefill` / `prefillComposer`, `web/src/lib/wherever.ts:539`, applied for `session_forked` at `wherever.ts:573`) — it is simply not wired to cancel.
2. **The cancelled bubble stays in the transcript, but only until reload.** `queue_update` only replaces `pendingSteering` and *adds* missing queued messages back (`client.ts:1926 withRestoredQueuedMessages`); it never removes the optimistic user bubble for a message that left the queue by cancellation. Because a queued steer is not written to the session file until pi injects it, that bubble is client-only: a reload makes it vanish. So the same cancelled message is simultaneously "still shown" (this tab) and "never existed" (after reload) — an inconsistency the user hits by doing nothing but refreshing.

The display half of (2) is already captured as an idea: `work/notes/ideas/bug-queued-message-not-removed.md`. This observation records the *data-loss* half (1) plus the reload-inconsistency framing, which that note does not cover.

## Why it matters

Cancel is the only way to retract a steer without aborting the turn, so users will reach for it whenever they steer too early, mistype, or change their mind mid-thought. But the text is often still valuable: "cancel" here usually means *"not now / not like that"*, not *"delete what I wrote"*. Today the only recovery is to retype it (and if the bubble already scrolled or the page reloaded, to retype it from memory). That makes cancelling feel punitive and pushes users towards Abort (which is more destructive) or towards leaving a bad steer queued.

## Open decision: what happens with more than one queued message?

`clearQueue()` is all-or-nothing (pi has no per-message dequeue), which is exactly why the affordance is session-level. So a cancel of N ≥ 2 messages has to decide what "bring it back" means. Options, none picked:

- **Restore only the latest** (the user's stated minimum). Simple, matches "I regret what I just typed", but silently drops the earlier N-1 texts — the same data loss, just smaller.
- **Restore all, joined** (e.g. newline-separated, newest last) into the composer. Nothing is lost, but it fuses distinct messages into one blob the user must re-split, and could dump a lot of text into a small mobile composer.
- **Restore the latest into the composer, keep the rest recoverable** (e.g. the cancelled bubbles stay in the transcript marked "cancelled" with a per-message "restore to composer" / copy action). Loses nothing, but needs a new visual state for cancelled-but-not-sent bubbles — which is also the natural fix for (2), since those bubbles have to stop pretending they are queued anyway.
- **Per-message cancel** (cancel one, re-queue the others). Closest to what the user probably means, but pi only offers clearQueue, so it means cancel-all-then-resend-the-keepers — a behaviour change with real failure modes (reordering, re-send racing the turn boundary) and probably its own spec.

Related but distinct: should a cancelled message be *persisted* at all, so it survives a reload? Today it cannot be (it was never in the session file). Any "recoverable later" answer implies client-side (or server-side) retention of cancelled text, which is a bigger decision than the composer prefill.

## Refs

- `web/src/lib/components/ChatMessageList.svelte:2341-2356` (session-level "Cancel queued" button), `:2197-2214` (per-message "Queued (not yet sent to the agent)" badge)
- `web/src/lib/wherever.ts:710` (`cancelSteer`), `:539` (`prefillComposer`), `:573` (fork's prefill precedent), `:892` (`pendingSteering` store)
- `client/src/client.ts:2173` (`cancelSteer`, optimistic clear), `:808` (`queue_update` reducer), `:1926` (`withRestoredQueuedMessages` — restores, never retracts)
- `server/src/index.ts:2044` (`cancel_steer` handler), `server/src/session-pool.ts:2079` (`cancelSteerQueue` → `clearQueue()`), `:2072` (`getSteeringQueue`, notes the queued text is NOT in the session file yet)
- `work/notes/ideas/bug-queued-message-not-removed.md` (the display-only half of this)

## Update 2026-07-31: the composer may already hold a draft, and today's prefill would eat it

A restore-on-cancel cannot assume an empty composer. The plausible flow is exactly the opposite: the user steers, then keeps typing the *next* message while the turn runs, then hits "Cancel queued". At that moment the box holds fresh, un-sent text that is at least as valuable as the retracted one.

The existing prefill path is a blind overwrite, so wiring cancel to it as-is would trade one silent data loss for another:

- `prefillComposer(text)` sets `composerPrefill` to `{text, bump+1}` (`web/src/lib/wherever.ts:539`), and the composer's effect does `text = prefillText` unconditionally (`web/src/lib/components/ChatInput.svelte:219-230`). It is written for fork, where it runs right after a session switch into a knowingly empty box ("deliberately wins over the (empty) hydrated draft").
- Drafts are persisted per session under `wherever-draft:<sessionId|search>` (`ChatInput.svelte:166-180`) and cleared on send, so an overwritten draft is not recoverable from anywhere either.

### Open decision: composer already non-empty

Options, none picked (this interacts with the N ≥ 2 decision above: whatever "restore" produces is the thing being merged):

- **Never clobber: only prefill when the composer is empty (trim-empty), otherwise leave the box alone.** Safest and trivial, but the cancelled text is then silently lost in exactly the case the user is most likely to be in, which defeats the point.
- **Append/prepend to the existing draft** (newline-separated). Loses nothing and needs no new UI, but fuses two distinct messages and can produce a confusing blob, especially combined with restore-all for N ≥ 2. Cursor placement matters (probably keep the user's own text where the cursor is and put the restored text above it).
- **Ask.** A small "restore cancelled message?" affordance instead of an automatic write: a toast/undo chip ("Cancelled. Restore") or a per-bubble "restore to composer" action on the cancelled bubbles. Zero clobber risk, no merge semantics to invent, and it composes cleanly with N ≥ 2 (restore them one at a time, in the order the user wants). Cost: a new transient UI surface, and an undo chip has to decide how long it lives.
- **Stash instead of prefill:** keep the cancelled text in a per-session "retracted" slot the user can pull from on demand. Most general, most machinery, and it reopens the persistence question (survives reload?) already flagged above.

A cheap invariant worth extracting regardless of the option chosen: `prefillComposer` currently means "replace the composer", and cancel-restore wants "offer this text without destroying what is there". Those are two different intents on one channel, so the decision should probably also say whether prefill grows a mode (replace / fill-if-empty / append) or whether restore gets its own path.
