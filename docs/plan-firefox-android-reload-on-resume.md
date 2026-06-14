# Plan: Mitigate Firefox Android reload-on-resume (slow, annoying)

**Status:** Planned, NOT implemented. Written 2026-06-14.
**Issue:** On Firefox for Android, locking the screen and returning to the app
reloads the page, which is slow and annoying.

## Background / what's actually happening

When a mobile browser backgrounds a tab (screen lock, app switch), the OS may
evict the tab from memory. On return, the browser either:
- restores from **bfcache** (back/forward cache) -> instant, OR
- **reloads** the document from scratch -> slow (re-run app, reconnect WS,
  re-fetch sessions, re-load history).

Firefox Android tends to reload rather than bfcache-restore, especially for
pages with open WebSocket connections and a controlling service worker.

## Evidence (from real files)

- No `visibilitychange`, `pageshow`, `pagehide`, `freeze`, or `resume` handling
  anywhere in `web/src` (grep returned nothing). So the app does nothing special
  on background/resume today.
- Open **WebSocket** connection (`@wherever-dev/client`) is a known bfcache
  disqualifier: pages with open WS are typically NOT eligible for bfcache, which
  pushes the browser toward a full reload.
- Hand-rolled **service worker** with a navigation branch that can return
  `new Response('', {headers: {Refresh: '0'}})` to force a refresh when a new SW
  is waiting and only one client. On resume this could trigger an immediate
  reload. Worth auditing as a contributing factor.
- `web/src/lib/wherever.ts`: client auto-connects on mount and reconnects; a full
  document reload therefore also pays reconnect + `fetchSessions` + history load
  (ties into the long-session-load plan).

## Key realities to set expectations

- We likely **cannot fully prevent** Firefox Android from discarding a
  backgrounded tab; that's an OS/browser memory decision. The realistic goal is:
  1. make resume **fast** even if a reload happens, and/or
  2. improve bfcache eligibility so resume is instant when the browser allows it.

## Options

### A. Make reload cheap (most reliable win)
- Persist enough UI state to restore instantly: current session id is already in
  the URL hash (`+page.svelte` syncs hash <-> session). Ensure on reload we:
  - reconnect quickly,
  - restore the active session from the hash without a visible full re-init,
  - lean on the long-session-load improvements (see
    `plan-speed-up-long-session-load.md`) so history paint is fast.
- Optionally cache last-rendered messages per session in `sessionStorage` to
  paint immediately, then reconcile with server.

### B. Improve bfcache eligibility
- Close/suspend the WebSocket on `pagehide`/`visibilitychange: hidden` and
  reopen on `pageshow`/`visibilitychange: visible`. Open WS blocks bfcache; if
  the socket is closed when backgrounded, the browser is more likely to keep the
  page in bfcache and restore instantly.
- Add `pageshow` handler: if `event.persisted` (restored from bfcache), just
  reconnect the WS and refresh session state; do NOT re-run heavy init.
- Risk: closing the WS on every hide may hurt desktop/foreground multi-tab UX and
  push notifications expectations; gate by viewport/mobile or make it
  configurable.

### C. Audit the service-worker navigation refresh
- Re-check the `Refresh: 0` navigation branch in
  `web/src/service-worker/index.ts`; ensure it cannot fire spuriously on resume
  (e.g. when a waiting SW exists). If it contributes, scope it tighter.

### D. Reconnect UX polish
- On resume, show a lightweight "reconnecting" state instead of a blank reload,
  so even a real reload feels fast and intentional.

## Recommended sequencing
1. **A** (make reload cheap) + dovetail with the long-session-load plan: this
   helps regardless of bfcache.
2. **B** (WS suspend/resume on visibility) to try to unlock bfcache on Firefox
   Android; measure whether resume becomes instant.
3. **C** (SW navigation audit) to rule out a self-inflicted reload.

## Investigation steps (do first)
- Instrument `visibilitychange`/`pageshow` (log `event.persisted`) on a Firefox
  Android device to confirm whether returns are bfcache restores or full
  reloads.
- Test whether closing the WS on hide changes bfcache eligibility on the device.
- Confirm whether the SW `Refresh: 0` branch fires on resume.

## Acceptance / verification
- On Firefox Android: lock screen, wait, return. Either the page restores
  instantly (bfcache) OR a reload completes fast with the active session restored
  from the hash and no jarring blank period.
- No regression on desktop Chrome/Firefox and iOS Safari (especially WS
  reconnection and push notifications).

## Risk / notes
- Device-specific behaviour; needs real-device testing, hard to unit test.
- B interacts with push-notification/WS expectations; gate carefully.
- Web-only (plus possibly client WS lifecycle helpers). Changeset:
  `"wherever-dev": patch` (and `"@wherever-dev/client": patch` if WS
  suspend/resume helpers are added to the client package).
