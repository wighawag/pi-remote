---
"wherever-dev": patch
---

Correct the PATH/environment caveat's account of the intermittency. Evidence from the richelieu drive sessions (~/.pi/agent/sessions) shows the git ENOENT toggled between consecutive tasks inside a SINGLE wherever process with the same, constantly-broken PATH. That toggling is not the systemd start-time race: the frozen process.env.PATH was constantly missing /usr/bin, and whether a given git spawn failed depended on which downstream code path (in dorfl) built the child env for that spawn. The docs now split the two layers explicitly: systemd/user-service setup explains why the PATH was incomplete at all (intermittent across service restarts), while a spawned tool's per-call-site env construction explains why the visible failure came and went within one process.
