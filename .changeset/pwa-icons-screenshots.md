---
"wherever-dev": patch
---

PWA polish: the installed app icon is now generated from the Wherever logo (`logo.svg`) instead of the old placeholder, a properly padded `maskable` icon is generated (fixing the previous broken/missing maskable icon reference), and the manifest now declares desktop (`wide`) and mobile screenshots so Chrome offers its richer install UI. Icon/screenshot assets are produced at build time via a post-process step from committed sources under `static/pwa-src/`.
