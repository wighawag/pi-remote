---
"wherever-dev": patch
"@wherever-dev/client": patch
---

Auto-clone an existing remote when creating a session in a not-yet-cloned project. Previously, starting a session in a non-existing folder that matched a `remoteRepoRules` pattern always tried to CREATE the remote (`gh repo create` / `tea`/`cb repo create`); if that repo already existed on the host, the create failed and the session was left as an empty local folder with no `origin`. Now, at submit time (not on every keystroke), the server probes the provider using the same authenticated CLI and owner it would use to create (`gh repo view` for GitHub, `tea`/`cb` listing for Codeberg/Gitea/Forgejo). If the repo is found, the dashboard asks whether to clone it (preferring the SSH remote) or create a new one anyway; cloning runs `git clone <ssh-url>` into the target folder and pre-configures upstream tracking. When no matching remote exists, behavior is unchanged and it falls back to the normal create path (any probe/CLI failure is also treated as "does not exist"). `WhereverClient.createSession` gains an optional trailing `cloneRemote` argument.
