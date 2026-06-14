# Plan: Fix stale-on-first-load caused by prerendering + service worker

**Status:** Planned, NOT implemented. Written 2026-06-14.
**Issue:** On first load, the web page shows the sessions list / state that was
present at build time, instead of current data.

## Evidence (checked against real files)

- `web/src/routes/+page.ts`: `export const ssr = false; export const prerender = true;`
- `web/src/routes/+layout.ts`: `export const prerender = true; export const ssr = true;`
- `web/svelte.config.js`: uses `@sveltejs/adapter-static` (pages + assets ->
  `build/`). So routes are prerendered to static HTML at build time.
- `web/src/service-worker/index.ts`:
  - `OFFLINE_CACHE = 'all'` -> caches `build`, `prerendered`, and `files`.
  - Same-origin requests (`sw.location.origin`) are matched by
    `regexesCacheFirst`, i.e. **cache-first**: it returns the cached response and
    only updates the cache in the background (`cacheFirst.method` returns
    `cache || fromNetwork`).
  - On `localhost` only, `regexesOnlineFirst` wins (DEV), so the staleness is
    masked locally and shows up on real deployments.

## Root cause analysis

Two separate effects can both contribute; the plan must disambiguate which is
actually biting:

1. **Service-worker cache-first on the app shell.** The prerendered HTML + JS
   shell is served from cache first, so a stale *app build* loads until the SW
   updates in the background and the user reloads again. This is about stale
   *code/shell*, not stale session data.
2. **Apparent stale session list.** The session list itself is fetched at
   runtime (`fetchSessions()` -> `GET /sessions`, in `session-store.ts`), so it
   should not literally be baked in at build time. BUT: if `GET /sessions`
   responses are also same-origin and therefore cache-first in the SW, the user
   can see a **cached old `/sessions` JSON** first. Need to confirm whether
   `/sessions`, `/config`, `/models` are being cached by the SW (they match
   `sw.location.origin` -> cacheFirst). This is the most likely real culprit for
   "stale data on first load".

## Investigation steps (do first, before changing anything)

1. Reproduce on a non-localhost deploy. Open devtools -> Application -> Cache
   Storage; confirm whether `/sessions`, `/config`, `/models` responses are
   present in `cache-<version>`.
2. Confirm via Network tab whether the first `/sessions` is served `(from
   ServiceWorker)` cache vs network.

## Options (pick after investigation)

### Option A (recommended): keep prerender for the shell, exclude API from SW cache
- Add the dynamic API endpoints (`/sessions`, `/config`, `/models`,
  `/check-path`, `/autocomplete-path`, `/session/*`, and the WS upgrade) to an
  **online-only** (or online-first) bucket in the service worker, so live data
  is never served from cache.
- Implement by adding their path patterns to `regexesOnlineOnly` (or
  `regexesOnlineFirst`) ahead of the same-origin `cacheFirst` rule. Order
  matters: the SW checks `[onlineFirst, onlineOnly, cacheFirst, cacheOnly]`.
- Keeps offline app-shell behaviour; only data is always fresh.

### Option B: app shell online-first, assets cache-first
- Make navigations (`event.request.mode === 'navigate'`) online-first so a new
  build is picked up immediately; keep hashed assets/images cache-first.
- Heavier change to the SW fetch strategy; also addresses stale *shell*.

### Option C: remove prerendering
- Set `prerender = false` in `+page.ts`/`+layout.ts`. With `ssr=false` already,
  this yields an SPA shell. This alone does NOT fix the SW cache-first behaviour,
  so it must be combined with A or B to actually fix stale data. Lowest value on
  its own.

**Recommendation:** Option A (exclude API/data routes from SW caching), likely
combined with making navigations online-first (part of B) so a fresh build is
picked up without a second reload. Leave prerendering on (it is harmless for an
`ssr=false` shell and keeps static hosting working).

## Acceptance / verification
- On a non-localhost deploy, first load after a server-side session change shows
  the **current** session list (verify in Network: `/sessions` served from
  network, not SW).
- App still works offline for the shell (if offline support is intended to be
  kept).
- `pnpm build` succeeds; SW registers; no regression in push notifications.

## Risk / notes
- The SW is hand-rolled; changing fetch routing risks offline behaviour. Keep
  the change minimal and pattern-scoped.
- Bumping the SW `version` (already git-sha based) forces cache invalidation on
  deploy; confirm the activate handler deletes old `cache-*` (it does).
- No protocol change; web-only.
- Changeset: `"wherever-dev": patch` (web is served by `wherever-dev`).
