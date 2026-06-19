# PWA update check on visibility (template change)

Upstream-template patch: makes an installed PWA actually surface the "new
version available" popup. Port this to the template so apps derived from it
benefit.

## Problem

In a normal Chrome tab the app updates fine: tabs constantly issue
`mode: 'navigate'` requests (reloads, URL typing), and the service worker's
"skipWaiting on navigate" trick (in `src/service-worker/index.ts`,
`getResponse`) activates a waiting worker on the next navigation.

In the **installed PWA** this never happens:

- The PWA is a SvelteKit SPA using hash / client-side routing, so after the
  shell loads it issues essentially **zero `navigate` requests**. The
  "skipWaiting on navigate" branch never fires, and a freshly deployed worker
  stays stuck in the `waiting` state forever.
- The update banner (`VersionAndInstallNotfications.svelte`) only appears after
  `registration.update()` discovers a new worker. But `handleAutomaticUpdate`
  only called `update()` on `focus` / `pointerdown` **after an idle threshold**
  (3 min) or on a long interval (30 min). On relaunch that idle gate usually is
  not satisfied, so no check runs on open, so the banner never shows.

Net symptom: browser tab updates and prompts; installed PWA keeps the old
version and never asks to update.

Note: the server side was already correct: `service-worker.js` is served with
`Cache-Control: no-cache` (only `/_app/immutable/` assets are long-cached), so
the SW script always revalidates. The bug was purely client-side.

## Fix

Force an explicit `registration.update()` check:

1. immediately on registration, and
2. every time the document becomes visible (`visibilitychange` ->
   `visibilityState === 'visible'`), i.e. on relaunch / tab re-show.

This makes the existing manual update popup actually appear in the PWA. The
manual popup is intentionally KEPT: accepting it posts `skipWaiting` to the
waiting worker (already working). We did not switch to silent auto-update.

The check is cheap (a conditional GET of the `no-cache` SW script) and changes
no caching or activation logic.

## Patch

File: `src/lib/core/service-worker/utils.ts`, inside `handleAutomaticUpdate`,
after the `['focus', 'pointerdown']` listener registration and before the
`setInterval` return:

```ts
// Installed-PWA update trigger.
// An installed PWA is a SPA (hash/client-side routing) and almost never
// issues a `mode: 'navigate'` request, so the service worker's
// "skipWaiting on navigate" trick (see src/service-worker/index.ts) never
// fires and a waiting worker is never surfaced. The idle-gated `wakeup`
// above also rarely passes right after a relaunch, so the update banner
// never appears. Force an explicit update check on launch and every time
// the app becomes visible (relaunch / tab re-show) so the manual update
// popup can actually be shown.
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible') {
		registration.update();
	}
});
// also check immediately on registration
registration.update();
```
