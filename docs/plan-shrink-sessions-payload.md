# Plan: Shrink and de-thrash the /sessions payload

**Status:** Planned, NOT yet implemented. Written 2026-06-14.
**Source:** Mobile Lighthouse run against the live dashboard
(`nono.bonobo-gentoo.ts.net:31415`), 2026-06-14.

## Why this is its own plan (not already covered)

Three related fixes already shipped, but NONE of them address this:

- `fix-stale-first-load` (shipped): made `/sessions` **online-first** in the
  service worker (correctness). Side effect: the full payload now always crosses
  the network on first load. It did not shrink it.
- `speed-up-long-session-load` (shipped): paginated the **message history of a
  single session** (`history_load_more` / tail-first windowing). That is a
  different payload from the **session list** at `/sessions`.
- `firefox-android-resume` (shipped): WebSocket/bfcache on resume. Unrelated to
  payload size.

So the size of the session-list payload is a genuine, still-open gap.

## Evidence (from the Lighthouse run)

- `GET /sessions` response: **resourceSize 3,915,323 bytes (~3.9 MB)**.
- It is refetched repeatedly in the first ~45s: observed at ~2.2s, 5.5s, 12.3s,
  23.4s, 28.5s, 28.9s, 32.8s, 37.4s, 41.1s, 44.8s. Each transfer takes
  ~1.5-2.8s under mobile throttling.
- The last `/sessions` in the trace is `finished: false, statusCode: -1`
  (cancelled/superseded mid-flight).
- Page metrics: FCP 4.4s, LCP 4.8s, TTI 6.9s, TBT 1.6s. The repeated
  multi-second `/sessions` fetches dominate the early network timeline.
- Note: most OTHER Lighthouse findings (console errors, unminified/unused JS,
  deprecations, best-practices 0.73) come from browser **wallet extensions**
  (`inpage.js`, `oneTap.js`, jQuery injected by MetaMask et al.), flagged by the
  run warning "Chrome extensions negatively affected this page's load
  performance." Those are NOT wherever code and are out of scope here.

## Root cause (verified in code)

`SessionPool.listSessions()` (`server/src/session-pool.ts`) builds each session
entry with `firstMessage: s.firstMessage` -- the **entire, untruncated** first
message of every session, for every folder. The `/sessions` handler
(`server/src/index.ts`, `pathname === '/sessions'`) returns all of it in one
JSON blob. With many sessions and long first messages (pasted prompts, PRDs,
specs), this grows without bound. The web only renders a short preview, so most
of those bytes are never displayed.

Secondary: the web refetches the whole list aggressively. `fetchSessions()`
(`web/src/lib/session-store.ts`) is triggered by the `sessions_updated`
WebSocket message (wired in `web/src/lib/wherever.ts`) and by
reconnect/visibility churn, so the 3.9 MB is pulled many times in a session.

## Likely link to the "connection error" on first load

The dashboard appears to surface a connection/error state while the initial
`/sessions` fetch is still in flight (it is large and slow, and can be cancelled
and retried). The fix below should make first load fast enough that the symptom
disappears; if it persists, treat the connect/fetch state machine separately
(distinguish "connecting / loading" from "errored" so an in-flight initial fetch
never renders as an error).

## Fix

### A. Shrink the payload (server, biggest win)
1. In `listSessions()`, replace `firstMessage: s.firstMessage` with a truncated
   preview, e.g. `firstMessagePreview: s.firstMessage.slice(0, 120)` (cap and,
   ideally, collapse whitespace/newlines). Rename the field to make the contract
   explicit, or keep `firstMessage` but document that it is a capped preview.
2. Audit `FolderSessionInfo` / `SessionInfo` (`server/src/session-types.ts`,
   `web/src/lib/session-store.ts`) and drop any field the sidebar never renders.
3. Update the web consumer (`SessionBrowser.svelte`, `session-store.ts` types)
   to use the preview field.
4. Target: from ~3.9 MB to tens of KB for a large list.

### B. De-thrash refetching (web)
1. Coalesce/debounce `fetchSessions()` (a debounce already exists; ensure
   `sessions_updated` bursts and reconnects collapse into one refetch).
2. Avoid a full refetch on every WebSocket `sessions_updated`; only refetch when
   the list actually changed, or refetch at most once per N ms.

### C. Optional follow-ups (only if A+B are not enough)
- Paginate or lazy-load `/sessions` per folder (the sidebar already groups by
  `cwd`; collapsed folders need not ship their sessions until expanded).
- Add an ETag / `If-None-Match` to `/sessions` so unchanged lists return 304.

## Validation
- Re-measure `/sessions` transfer size (expect tens of KB).
- Confirm the sidebar still shows the same previews and grouping.
- Confirm first load no longer flashes a connection error (or fix the state
  machine if it still does).
- `pnpm --filter ./server build` clean; `pnpm --filter ./web check` clean.
- Changeset: server + web -> `"wherever-dev": patch` (or `minor` if the
  `/sessions` field is renamed, since that is a visible contract change). If the
  protocol/client package is touched, also bump `"@wherever-dev/client"`.

## Out of scope
- Wallet-extension noise in the Lighthouse report (not wherever code).
- HSTS/CSP/COOP headers (informational for a Tailscale-fronted personal tool).
- Per-session message-history pagination (already shipped).
