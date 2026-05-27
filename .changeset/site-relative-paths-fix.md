---
"pi-remote-server": patch
---

Configure both `web` and `site` packages for static site pre-rendering by setting `prerender = true` (in page/layout routing) and removing `fallback: 'index.html'` from the svelte static adapter configs. This enables SvelteKit to generate correct, portable relative-path references in the built HTML files, allowing the dashboard and marketing website to load perfectly under subpaths or IPFS gateways.
