---
"wherever-dev": patch
"@wherever-dev/pi": patch
---

Add an inviting "agent is waiting for you" beep to both the web frontend and the CLI bridge extension.

Both surfaces can now play a gentle sound the moment the agent finishes and is waiting for a human message, so you can look away and be called back when it is your turn. The beep is DISABLED by default on both. Each surface has a per-session toggle, and a config that sets the default for new sessions (which the per-session toggle can still override). The two surfaces are configured independently.

Web frontend (`wherever-dev`): the chime is synthesised with the Web Audio API (a soft two-note rising interval, no bundled asset) and fires on the `isStreaming` true -> false edge for the active session. Connection Settings has a "Beep when the agent is waiting" checkbox (`beepDefault`) for the persisted default and an optional custom sound URL (`beepSoundUrl`, played via an `Audio` element, with a Test button; blank = built-in chime), both persisted in the `wherever-config` localStorage entry.

The chat toolbar (next to "Hide Thinking" / context usage) has a tri-state per-session beep control that cycles Default -> On -> Off -> Default. Per-session choices are stored per session id (persisted in a separate `wherever-beep-overrides` localStorage map), so a session with NO explicit choice follows the global default live (changing the default updates it), while an explicit On/Off sticks to that session across session switches and reloads, unaffected by later default changes, until cleared back to Default. The default is a reactive store so toggling it in the Config menu takes effect immediately.

CLI bridge extension (`@wherever-dev/pi`): plays a sound on the `agent_settled` event (the run has fully settled and is genuinely waiting for input, so it does not fire between chained internal turns).

- Enabled by default when EITHER the `--remote-beep` flag is set OR `beep.enabled: true` in `~/.wherever/config.json` (the flag can only force-on, so the config file is the way to enable-by-default without passing the flag). Default off.
- `/remote-beep [on|off]` toggles it for the current session (no argument toggles; enabling plays a sample); resets to the configured default on each session start.
- Sound resolution, highest precedence first: `--remote-beep-command` flag, then `beep.command` in `~/.wherever/config.json`, then an auto-detected player + a system chime (`pw-play`/`paplay`/`canberra-gtk-play`/`ffplay` + freedesktop `complete.oga`, or `afplay` on macOS), then a terminal bell. The bell (`\x07`) is written to `/dev/tty` rather than stdout because pi's TUI owns stdout and can swallow an out-of-band byte; the command path exists because many terminals (e.g. WezTerm on Linux) have a silent audible bell.

Also adds a typed `beep` section (`enabled`, `command`) to the server's `WhereverConfig` (the shared `~/.wherever/config.json` type), which the extension reads directly.
