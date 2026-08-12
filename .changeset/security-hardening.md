---
"wherever-dev": patch
---

Security hardening: command injection, eruda DOM-XSS, and path-scoping fixes.

- **Command injection in remote-repo provisioning (critical):** all `gh`/`tea`/`cb`/`git` calls in the session pool now use `execFileSync` with argument arrays instead of `execSync` with interpolated shell strings. A client-supplied folder basename could previously break out of a quoted shell argument (e.g. `x";touch /tmp/pwned;"`) and run commands as the server user when `remoteRepoRules` was configured. The `tea`/`cb` `… | grep` pipelines were rewritten to read CLI output and match in JS. The `openssl` self-signed-cert generation was converted too.
- **Unauthenticated route:** `/check-remote-repo` (the only reach that fired the injection without a token) is now behind the auth gate.
- **eruda DOM-XSS (high):** the dashboard's eruda custom-plugin loader took `?eruda=<pkg>` and wrote it unescaped into a `<script src>`, letting a crafted link inject attacker JS that could read the auth token from `localStorage`. Plugin loading is now gated behind a `<meta name="wherever-eruda-plugins">` flag that is `false` in the built shell and only flipped to `true` when the server runs with `--debug` (or `PI_DEBUG`/`WHEREVER_DEBUG`). Core eruda still loads for phone debugging.
- **`/session/delete`:** now scoped to `.jsonl` files inside the server's sessions directory, so an authenticated caller can no longer `unlink` arbitrary `.jsonl` files anywhere on disk.
- **`/check-path` and `/autocomplete-path`:** now scoped to the home directory, so they can no longer be used to enumerate arbitrary paths on the server.
- Added a `--debug` server flag (and `PI_DEBUG`/`WHEREVER_DEBUG` env vars) that enables eruda custom-plugin loading in the served dashboard for local debugging.