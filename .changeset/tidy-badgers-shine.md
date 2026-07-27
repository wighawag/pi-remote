---
"wherever-dev": patch
---

Show the server version next to the web app build id. The connection panel already displayed the frontend build (the short git commit baked in at build time), but there was no way to tell which server version that frontend was actually talking to, which made it easy to debug a stale server as if it were a frontend bug.

The server now reports its package version in the `connected` WebSocket message, the client keeps it in state as `serverVersion` (null until connected, or when the server is old enough not to report it), and the connection panel renders it as `v<build> / srv <version>` with both spelled out in the tooltip.
