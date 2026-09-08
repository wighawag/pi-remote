# The auth token never has to appear in argv, and a mounted-but-unreadable token file is FATAL

**Status:** accepted

`/proc/<pid>/cmdline` is mode `0444` on Linux, so `wherever start --token <secret>` publishes the token to every local user via a plain `ps`. That is tolerable on a single-user laptop and not tolerable on the shared bare-metal host wherever is moving to, where the token is the only thing between an unauthenticated caller and a coding agent with full filesystem access. The token therefore needs a channel that is not argv.

## Resolution order

First non-empty wins:

1. `--token <value>` — argv. Kept working unchanged, and now warns at startup that it is visible via `ps`.
2. `WHEREVER_TOKEN` — the environment. `/proc/<pid>/environ` is readable only by the process owner and root, so this is the ordinary deployment channel.
3. `WHEREVER_TOKEN_FILE` — a path whose trimmed CONTENT is the token. The shape a secret manager actually produces (sops-nix, systemd `LoadCredential=`): the secret exists only as a root-owned `0400` file, and neither argv nor the environment block ever contains it, only the path.
4. `PI_REMOTE_TOKEN` — the pre-existing variable, still honoured, last so it cannot shadow a newer explicit setting.

Argv is ranked FIRST despite being the least safe, because precedence should follow explicitness, not safety: an operator typing a flag on a one-off command expects it to win over ambient environment they may not even know is set. Safety is addressed by making the unsafe option loud, not by making it lose silently.

## Compatibility rules the resolution order has to respect

Two of the four sources predate this change, and `authenticate()` compares the raw query parameter with `===`, so any normalisation applied to them changes WHICH string authenticates on an install that already works. Both are therefore consumed exactly as before:

- **`--token` and `PI_REMOTE_TOKEN` are taken VERBATIM, untrimmed.** The two new sources ARE trimmed, because a secret manager renders a file with a trailing newline and `WHEREVER_TOKEN=$(cat ...)` is the obvious thing to write. Trimming the old two would silently lock out every saved client URL on an install whose token happens to carry a space or newline. The asymmetry is the compatibility rule, not an oversight.
- **`--token` wins whenever the FLAG WAS GIVEN, even with an empty or missing value.** The old `case '--token': token = args[++i]` assigned unconditionally, so `--token ''` (or a trailing `--token`) overwrote whatever the environment held and produced an unauthenticated server. Resolving on the flag's VALUE rather than its PRESENCE would quietly turn that into a gated one.

## A token variable that is set but BLANK is loud, not silent

`WHEREVER_TOKEN=` (or whitespace) is what a half-landed secret render looks like: the file was truncated, the `$(cat ...)` failed, the activation raced. The resulting server is unauthenticated and looks perfectly healthy. It cannot be made fatal, because `VAR=` is also the ordinary way to neutralise an inherited variable, so instead it warns explicitly that a secret may not have arrived. Separately, binding a **non-loopback** address with no token at all warns too: that combination stays permitted (it is how a trusted-mesh setup runs) but it is indistinguishable from a failed secret render, so it must not pass by as one parenthetical word in a cheerful startup line.

## A token file that cannot be read is a startup FAILURE

If `WHEREVER_TOKEN_FILE` is the source being consulted (nothing higher in the chain supplied a token) and the file is missing, unreadable, or empty, the server prints a fatal message and exits non-zero rather than falling through to "no token". An explicit `--token` or `WHEREVER_TOKEN` above it still wins, and the server is authenticated either way, so the fatal path fires exactly when it is the difference between authenticated and open.

This is the real trade-off in this ADR, and it is deliberately the unavailable side. The failure being guarded is a secret that did not mount: sops-nix has not decrypted yet, the unit ordering is wrong, a key rotation half-landed. Falling through means the server comes up **successfully, on `0.0.0.0`, with authentication silently disabled**, looking healthy in `systemctl status` while being wide open. A service that refuses to start is a loud, obvious, immediately-fixed problem; a service that starts unauthenticated is a silent one that may not be noticed at all. Availability is worth less here than the guarantee that "it is running" implies "it is protected".

Note the asymmetry: this applies only when the operator ASKED for a token file. Setting no token at all remains a valid, unchanged configuration (the default bind is `127.0.0.1`), because that is an explicit choice rather than a failed one.

## The same rule applies to explicitly-configured TLS

The server used to catch a failure to load an explicitly-supplied `--ssl-key`/`--ssl-cert`, log it, and **fall back to plaintext HTTP on the same address** (frequently `0.0.0.0`). That is this ADR's fail-open, one layer down: it is the identical "the secret has not decrypted yet" race, and the consequence is that clients then send their token in cleartext to a server that looks healthy. So when TLS material was EXPLICITLY pointed at and cannot be loaded, the server now exits non-zero as well. The silent HTTP fallback survives only for the pair the server mints for itself, where nothing was asked for and nothing is betrayed. `--no-ssl` remains the way to ask for plaintext on purpose.

## Consequences

The startup banner reports the token's SOURCE (`token-protected via WHEREVER_TOKEN_FILE (/run/secrets/...)`) and never the token, since that line lands in the journal, which is readable by more people than the secret is.

The token is also DELETED from `process.env` once resolved. Node builds a child's environment from `process.env`, and this server spawns children that must not be trusted with it: the agent's own `bash` tool and the memonaut indexer both inherit it, so `!env` typed in the dashboard, or a prompt-injected agent running `echo $WHEREVER_TOKEN`, would print the server's auth token into a transcript that is then indexed to disk. (`/proc/<pid>/environ` still shows it — that is the kernel's snapshot of the original block and cannot be changed — but it is readable only by the owner and root.)

**The threat model is only half closed.** The CLI bridge still takes `--remote-token` on its own command line (`@wherever-dev/pi`, a separate published package), so `pi --remote-token SECRET` publishes through `ps` exactly what the server now avoids. Giving the client the same environment-first treatment is follow-up work in that package.
