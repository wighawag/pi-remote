---
"wherever-dev": minor
---

Add `wherever install` / `uninstall` / `service-status` subcommands to run the server as a background service.

On Linux it writes a systemd unit (a per-user unit under `~/.config/systemd/user/` by default, or a system-wide unit with `--system`) and enables/starts it. On macOS it writes and loads a per-user launchd LaunchAgent under `~/Library/LaunchAgents/`. Server flags like `--port`, `--host`, and `--token` are baked into the service invocation.

On install (unless `--no-pi-config`) the `npm:@wherever-dev/pi` extension is added to the `packages` array in `~/.pi/agent/settings.json` if it is not already configured, so a running pi CLI bridges into the same server automatically. The existing settings file is backed up to `settings.json.bak` before it is modified. A `--dry-run` flag prints the unit/plist and the actions without writing anything.

The server is now started with an explicit verb: `wherever start [server flags]`. A bare `wherever` prints the command help instead of starting the server (breaking change; acceptable pre-1.0). All existing server flags work unchanged after `start`. Windows is not supported yet; the command prints the manual steps instead.
