---
"pi-remote-server": patch
---

Fix the `/new` / `session_new` command on the server so that it successfully creates a brand new, clean session instead of returning the existing active session when the requesting client is already connected to it.
