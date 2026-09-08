# The config directory may be READ-ONLY; everything the server writes moves to a separate state directory

**Status:** accepted

Wherever is being deployed as a declarative NixOS system service instead of a hand-installed user unit. That imposes a constraint the code did not satisfy: the configuration is rendered at activation by sops-nix into a root-owned `0400` file under `/run`, because it contains secrets. The service can READ it and can never WRITE next to it. Today `~/.wherever` is both the place `config.json` is read from AND the place `drafts.json` is written to, so a read-only config directory breaks saved drafts entirely.

## The decision

Split the single directory into two roles, each with its own environment variable:

| | variable | default | who writes it |
| --- | --- | --- | --- |
| **config** | `WHEREVER_CONFIG_DIR` | `~/.wherever` | the operator / the deployment |
| **state** | `WHEREVER_STATE_DIR` | **the resolved config dir** | the server |

`WHEREVER_STATE_DIR` defaults to `getWhereverConfigDir()`, not to `~/.wherever` and not to an XDG path. That is the load-bearing detail: with the variable unset, every existing install (and every existing test, which sets only `WHEREVER_CONFIG_DIR`) resolves to byte-identically the path it used before, so the change is purely additive and no migration exists to get wrong. A deployment that needs the split opts in by setting one variable.

Moved into the state dir: `drafts.json` and the auto-generated self-signed TLS pair (`certs/localhost.{key,crt}`). Note the certs directory previously ignored `WHEREVER_CONFIG_DIR` too, so anyone already setting that variable AND hand-placing a real certificate in `~/.wherever/certs` needs to move it or set `WHEREVER_STATE_DIR=~/.wherever`; this is the one pre-existing-variable behaviour change, and it is called out in the README. The certificates were previously built from `os.homedir()` DIRECTLY, so `WHEREVER_CONFIG_DIR` did not move them and an isolated server still wrote into the developer's real `~/.wherever`; routing them through the state dir closes that inconsistency as a side effect rather than as a second mechanism.

## Rejected alternatives

**Make `drafts.json` the only thing that moves, with a `WHEREVER_DRAFTS_PATH`.** One variable per file does not scale, and the question is not "where does this one file go" but "which of these two roles does this path serve". The next writer would need a third variable and would probably just get the old default by accident.

**Use XDG (`$XDG_STATE_HOME/wherever`) as the state default.** Correct in the abstract, and wrong here: it silently relocates every existing user's saved drafts on upgrade. Drafts are text the user explicitly asked to keep, so a default change that strands them is not an acceptable price for tidiness. The state dir can be pointed at an XDG path by anyone who wants one.

**Keep writing into the config dir and require the deployment to make it writable.** That is the thing being removed. A config directory holding a `0400` secret cannot also be a scratch directory without either exposing the secret or splitting the file out anyway.

## Consequences

- Seeding a default `config.json` is now a best-effort, non-fatal WARNING rather than an error: an unwritable config dir is a supported deployment, not a broken one.
- `systemd` deployments get an exact mapping: the state dir is what `StateDirectory=` should point at. As of this ADR **wherever itself** writes exactly `drafts.json` (not regenerable, back it up) and `certs/` (regenerable). That is deliberately NOT the same as the deployment's backup set: session transcripts are written by the pi SDK under `PI_CODING_AGENT_DIR`, which a real unit will usually place inside the same state directory, and they are the most valuable data on the box. "What wherever writes" and "what to back up" are different questions; `docs/deployment-nixos.md` answers the second one.
- Opting IN to a separate state dir does not migrate anything. An existing install moving to one starts with an empty drafts list until `~/.wherever/drafts.json` is copied across; the old file is neither read nor removed. Callout in the deployment checklist rather than an auto-migration, because guessing which of two files is authoritative is worse than saying so.
- A future writer must go in the STATE dir. If something genuinely needs to be written next to the config, that is a design smell to resolve, not a reason to reopen the config dir for writing.
