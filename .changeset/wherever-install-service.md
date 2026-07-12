---
"wherever-dev": minor
---

Add `wherever install` / `uninstall` / `service-status` subcommands to run the server as a background service.

On Linux it writes a systemd unit (a per-user unit under `~/.config/systemd/user/` by default, or a system-wide unit with `--system`) and enables/starts it. On macOS it writes and loads a per-user launchd LaunchAgent under `~/Library/LaunchAgents/`. Server flags like `--port`, `--host`, and `--token` are baked into the service invocation.

On install (unless `--no-pi-config`) the `npm:@wherever-dev/pi` extension is added to the `packages` array in `~/.pi/agent/settings.json` if it is not already configured, so a running pi CLI bridges into the same server automatically. The existing settings file is backed up to `settings.json.bak` before it is modified. A `--dry-run` flag prints the unit/plist and the actions without writing anything.

Running `wherever` with no subcommand still starts the server exactly as before. Windows is not supported yet; the command prints the manual steps instead.
