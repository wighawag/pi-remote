---
"wherever-dev": patch
---

deploy: add `--sudo-password` option to the cloud-init generator that lets the wherever service run `sudo` but requires the user's password (collected by the frontend and piped to `sudo -S`). It sets a real login password on the account, switches sudoers to `ALL=(ALL) ALL`, and relaxes the systemd sandbox (`NoNewPrivileges=false`, `ProtectSystem=off`) so escalation actually works. The default (passwordless, fully-sandboxed, sudo-blocked service) is unchanged.
