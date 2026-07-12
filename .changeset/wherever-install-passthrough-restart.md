---
"wherever-dev": patch
---

`wherever install` now forwards all server flags directly, no separator needed. Install owns only `--system`, `--no-pi-config`, and `--dry-run`; every other argument is passed verbatim to the baked `wherever start` command. So `wherever install --host 0.0.0.0 --port 31415 --http-localhost-fallback` works, and any server flag (`--host`, `--port`, `--token`, `--http-localhost-fallback`, `--no-ssl`, `--ssl-key`, `--idle-timeout`, ...) can be baked into the service without install modelling each one. A leading `--` separator is still tolerated (and ignored) for backward compatibility. On Linux, re-running `install` now also restarts the running service so the freshly written options take effect immediately (previously `enable --now` left an already-running process on the old `ExecStart` until the next restart), mirroring the launchd unload+load behavior on macOS.
