---
"pi-remote-server": patch
---

Normalize `cwd` paths in the server's session pool before creating, loading, or registering sessions. This resolves duplicate session folders when a workspace is accessed with vs. without a trailing slash (e.g. `--home-wighawag...--` vs `--home-wighawag...---`), fragments conversation history, and handles relative segments and double slashes.
