---
"wherever-dev": patch
---

Fix server test isolation: the integration harness spawns the real server with
`...process.env`, so an ambient `PI_REMOTE_TOKEN` (present when tests run inside a
wherever-managed shell) made the server enforce auth and reject the token-less
test WS client with `401`, failing all 13 server tests. The harness now
neutralizes every leaking `PI_REMOTE_*` var (token, host, port, SSL, HTTP
fallback) so its documented "no token / no SSL" intent holds regardless of the
ambient environment.
