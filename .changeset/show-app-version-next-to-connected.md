---
"wherever-dev": patch
---

Show the app build version next to the "Connected" indicator in the web frontend. Uses SvelteKit's built-in `version` (already wired to the git short hash, with a `-dirty` suffix when the tree has uncommitted changes), rendered right-aligned in a muted monospace style so you can tell at a glance which UI build is loaded.
