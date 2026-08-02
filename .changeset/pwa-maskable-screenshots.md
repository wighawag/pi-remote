---
"@wherever-dev/web": patch
---

Fix the shrunken Android home-screen PWA icon and remove the fragile PWA post-process.

The installed app icon had been shrinking over time to a tiny logo on a white
circle because the deployed build shipped pwag's raw manifest (no maskable
icon): the hand-rolled `pwa-postprocess.mjs` failed silently when ImageMagick
was missing on the build machine, and `prepare`'s `|| echo ''` swallowed the
error.

- Use pwag 0.6.0 native maskable icon generation (`maskable: true`): padded,
  fully-opaque maskable icons at 192/512 with `purpose: "maskable"`, plus
  explicit `purpose: "any"` on the regular icons — generated via `sharp`, with no
  ImageMagick dependency.
- Use pwag 0.6.0 native `screenshots` support: sources under `pwa-assets/` are
  copied into `static/pwa/` and emitted in the manifest with auto-detected
  sizes/type.
- Delete `web/scripts/pwa-postprocess.mjs`; `generate-pwa-icons-and-tags` is now
  a single `pwag static/logo.svg src/web-config.json` invocation.
- `prepare` no longer swallows failures, so a broken PWA build fails loudly
  instead of shipping a raw manifest.