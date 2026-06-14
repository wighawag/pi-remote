---
"wherever-dev": patch
---

Improve Lighthouse scores for the dashboard PWA.

- Web: stop shipping un-minified production assets. The Vite build had an
  inherited `minify: false` override which left JS/CSS unminified, roughly
  halving the largest chunk's size and fixing slow First/Largest Contentful
  Paint. Sourcemaps stay enabled for debuggable production stack traces.
- Server: set `Cache-Control` headers when serving static files. Content-hashed
  `/_app/immutable/` assets are served `public, max-age=31536000, immutable`;
  the HTML app shell, manifest and other top-level files stay `no-cache` so a
  freshly deployed build is always picked up. This fixes the "efficient cache
  lifetimes" audit without affecting the service worker's own caching.
- Server: add `.txt` and `.webmanifest` MIME types so robots.txt is served as
  `text/plain` and the manifest as `application/manifest+json` instead of
  `application/octet-stream`.
- Web: add a minimal valid `robots.txt` so the SPA fallback no longer returns
  the HTML app shell for `/robots.txt` (which Lighthouse flagged as invalid).
  Wherever is a private Tailscale-only tool, so it disallows all crawlers.
