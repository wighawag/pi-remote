# Plan: Speed up loading of long sessions

**Status:** Planned, NOT implemented. Written 2026-06-14.
**Issue:** Long sessions take a noticeable time to load.

## Evidence (from real files)

- `server/src/session-pool.ts` `getSessionHistory(sessionFileOrId)`:
  - `SessionManager.open(tracked.sessionFile)` then `sessionManager.getEntries()`
    reads and parses the **entire** session file synchronously.
  - It iterates ALL entries and builds a full `HistoryMessage[]` (user,
    assistant, thinking, toolCall, toolResult, bashExecution, ...). No limit, no
    pagination, no truncation.
- `server/src/index.ts`: multiple sites send the whole array in one
  `message_history` WS message (`messages: history`).
- `client/src/client.ts`: on `message_history` it maps the entire array into
  `ChatMessage[]` and sets state in one go; the UI (`ChatMessageList.svelte`)
  renders all messages.

So the cost is threefold and all O(total session size):
1. **Server**: parse whole JSONL + transform every entry on each load/join.
2. **Transport**: one large WS payload.
3. **Client**: map all messages + render all DOM nodes at once.

## Goals

- First paint of a long session should be fast (show the latest N messages
  quickly), with older history available on demand.
- Avoid re-parsing the entire file repeatedly when possible.

## Options (can combine)

### A. Tail-first windowing (recommended first step)
- Server: send only the **last N** messages (e.g. 50-100) in the initial
  `message_history`, plus a flag/cursor indicating more exist.
- Add a "load older" request (`history_before <cursor>`/offset) that returns the
  previous window. Client prepends on demand (scroll-up or a button).
- Requires: a small protocol addition (new WS message type or params on the
  existing load), a cursor/offset scheme, and client-side prepend + scroll
  anchoring.

### B. Client-side virtualization
- Render only visible messages (windowed list) in `ChatMessageList.svelte` even
  if all are in memory. Reduces DOM cost (effect 3) without protocol changes.
- Good complement to A; on its own it does not fix server parse + payload cost.

### C. Cheaper server transform / caching
- Cache the transformed `HistoryMessage[]` (or the parsed entries) per tracked
  session so repeated joins don't re-parse from disk.
- Invalidate on new messages (append-only: can incrementally append rather than
  rebuild).
- Reduces effect 1 for repeat loads.

### D. Streamed/chunked history
- Send history in chunks over several WS frames so the UI can paint the first
  chunk immediately. More complex; A+B usually enough.

## Recommended sequencing
1. **A (tail-first windowing)** for the biggest perceived win on first load.
2. **B (virtualization)** to keep scrolling smooth for very long sessions.
3. **C (server-side caching/incremental)** if profiling still shows server
   parse as a bottleneck on repeated joins.

## Investigation steps (do first)
- Measure: time `getSessionHistory` on a known-large session; measure WS payload
  size; measure client map+render time. Decide N for the initial window from real
  numbers.
- Check whether `@earendil-works/pi-coding-agent` `SessionManager`/`getEntries`
  supports any range/tail read; if so, use it to avoid full parse (key for A+C).

## Protocol / API impact
- A and D change the WS protocol (new message type or params). Update:
  - `server/src/protocol.ts` and the send sites in `server/src/index.ts`.
  - `client/src/client.ts` (handle windowed history + request older).
  - `web/src/lib/components/ChatMessageList.svelte` (prepend + scroll anchor).
- B is web-only.
- C is server-only.

## Acceptance / verification
- A long session (e.g. thousands of entries) shows the latest messages within a
  small, bounded time; scrolling up loads older history smoothly.
- No message loss or duplication at window boundaries; scroll position stays
  anchored when older messages are prepended.
- Short sessions behave exactly as before.

## Risk / notes
- Scroll anchoring on prepend is the main UX pitfall; budget time for it.
- Changeset: if protocol touched -> `"wherever-dev": patch` and
  `"@wherever-dev/client": patch` (and `@wherever-dev/pi` if the bridge path is
  affected). Web-only changes -> `"wherever-dev": patch`.
