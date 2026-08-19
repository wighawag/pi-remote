---
"wherever-dev": patch
---

Order sidebar fork groups by their most recent activity across forks.

Session groups were ordered by the top-most parent's own `modified` time, so a session forked long ago and worked on all day stayed buried under its stale root, making the active fork hard to find. Each fork group (a root plus its descendants) is now ranked by the newest `modified` in its whole subtree, and siblings are ranked the same way, so an active branch floats its group to the top while the parent/child tree shape is preserved. Ties fall back to the session's own `modified` then its path for a deterministic order.

The tree builder moved out of `SessionBrowser.svelte` into `web/src/lib/core/fork-tree.ts` with unit tests.
