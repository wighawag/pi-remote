---
"wherever-dev": patch
---

Server: expand a leading `~` in `remoteRepoRules[].pattern` before matching. The pattern is tested against the absolute, tilde-expanded folder path (e.g. `/home/user/dev/...`), so a rule written as `~/dev/github/me/.*` (the natural form, mirroring `commonFolders`) never matched and the auto-remote-repo creation silently did not fire. A leading `~` in the pattern is now expanded to the home directory first. Absolute patterns are unaffected, and an invalid regex is treated as a non-match instead of throwing.
