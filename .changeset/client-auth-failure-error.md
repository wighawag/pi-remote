---
"@wherever-dev/client": minor
"wherever-dev": patch
---

Client: surface an actionable error when the WebSocket handshake keeps being rejected instead of silently reconnecting forever. The server rejects a missing or wrong token with HTTP 401 during the WS upgrade, which a browser WebSocket can only observe as an opaque 1006 close, so the dashboard previously just showed `reconnecting to relay (attempt N)` with no hint of the cause. The client now tracks whether it has ever connected; after a couple of failed attempts with zero successful opens it sets a clear error ("the connection is being rejected... missing or wrong token, or wrong host/port/scheme...") while still retrying. A drop after a successful connection is still treated as a normal transient reconnect.
