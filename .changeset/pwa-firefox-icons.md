---
"wherever-dev": patch
---

PWA: make the installed icon resolve correctly on Firefox Android. Regular icons now carry an explicit `purpose: "any"` (some Firefox versions otherwise fall back to a generated letter icon), and maskable icons are generated at both 192 and 512 (Firefox prefers a maskable at the launcher size). Firefox still overlays its own small badge on installed-PWA icons, which is a browser behaviour and not controllable from the manifest.
