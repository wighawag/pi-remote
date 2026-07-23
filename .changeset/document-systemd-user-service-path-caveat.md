---
"wherever-dev": patch
---

Document the systemd user-service PATH/environment caveat in the README, and record the root-cause investigation under docs/. The root cause is the service environment wiring, not application logic: a Linux user service does not source the login shell and snapshots the systemd user-manager environment once at start; if that PATH was imported in stages and was still incomplete (e.g. missing `/usr/bin`) when the service started, every tool it shells out to (git, ssh, coreutils) can fail with an intermittent, start-time-ordering-dependent ENOENT. The README note explains how to get the full user PATH (volta/pixi/etc) into the service via `systemctl --user import-environment PATH` + restart (the recommended way to carry your session PATH), or by pinning `Environment=PATH=` / `environment.d` for deterministic/headless setups, and gives diagnostic commands to inspect the running service's frozen PATH. Docs only; no code or unit change.
