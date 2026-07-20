---
"wherever-dev": patch
---

Pin `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` to an exact version (`0.80.6`) instead of the loose `^0.80.3` range. A later `0.80.x` patch release removed the `AuthStorage` export that `session-pool.ts` imports, so fresh global installs (no lockfile) resolved a broken version and crash-looped on startup with "does not provide an export named 'AuthStorage'". Exact pinning prevents that drift.
