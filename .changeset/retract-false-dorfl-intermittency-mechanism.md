---
"wherever-dev": patch
---

Retract the incorrect "dorfl builds its child env differently per call site" explanation of the git ENOENT intermittency. Checked against the dorfl source (the commit that failed): dorfl does NOT edit PATH anywhere; run/runAsync spawn with `env: options.env ?? process.env` and identityEnv builds `{...base}`, faithfully propagating whatever PATH it inherited. The richelieu drive-session run markers show the failure was uniform within the process (every first-attempt hit ENOENT, including memory-pillar), and the `merged` results came from re-runs after a `~/.local/bin/git -> /usr/bin/git` workaround. So there is one cause (wherever handed dorfl a PATH without /usr/bin, dorfl passed it straight to git) and the only real intermittency is across service restarts (the systemd snapshot layer). Docs corrected accordingly; no code change.
