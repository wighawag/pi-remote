---
"@wherever-dev/pi": minor
---

CLI bridge: add `--remote-insecure` to connect to the standalone server over plain `ws://`. `--remote-secure` defaults to true and pi boolean flags cannot be forced false on the command line, so a server started with `--no-ssl` (e.g. bound to localhost behind a reverse proxy such as Caddy or nginx that terminates HTTPS) was unreachable from the bridge over the loopback address. Passing `--remote-insecure` now forces a plain `ws://` connection (it overrides `--remote-secure`). Alternatively you can still point the bridge at the proxy's public HTTPS endpoint and let the default WSS work. README updated to document both.
