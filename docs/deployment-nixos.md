# Deploying wherever declaratively (NixOS + sops-nix)

This is the deployment `wherever install` is **not** for. `install` writes a systemd unit imperatively, which is exactly the thing a declarative system manages for you; on NixOS you write the unit in your configuration and never run `install` at all.

Two properties make this work, and both are opt-in via environment variables (with everything unset, the server behaves exactly as it always has):

1. **The config directory can be read-only.** `WHEREVER_CONFIG_DIR` is where `config.json` is READ from; `WHEREVER_STATE_DIR` is where the server WRITES. See [ADR 0006](adr/0006-config-dir-is-read-only-state-lives-in-a-separate-state-dir.md).
2. **No secret has to appear in argv.** `/proc/<pid>/cmdline` is world-readable. See [ADR 0007](adr/0007-secrets-never-in-argv-token-resolution-order.md).

## Getting the package

`package.nix` is a plain function of `pkgs`, so a deployment repo builds it against a nixpkgs **it** chooses, without adding this repo's flake as an input:

```nix
# services/wherever/package.nix in your deployment repo, or straight from a pinned source
let
  whereverSrc = pkgs.fetchFromGitHub {
    owner = "wighawag";
    repo = "wherever";
    rev = "<the rev you pin>";
    hash = "sha256-...";
  };
in
import "${whereverSrc}/package.nix" { inherit pkgs; }
```

`nodejs` and `pnpm` are overridable arguments (defaulting to `nodejs_24` / `pnpm_10`), as is `pnpmDepsHash`.

**Which nixpkgs the pinned hash is valid against.** `package.nix` passes `fetcherVersion = 4` to `pnpm.fetchDeps`, which needs a nixpkgs recent enough to support it (nixos-25.11 or later; older pins `throw` with "`fetcherVersion` is not set to a supported value"). The pinned `pnpmDepsHash` is also tied to the exact `pnpm_10` patch release that produced it. Both failures are **loud** — an eval `throw` or a hash mismatch, never a silent wrong build — and both are fixed the same way: regenerate the hash against your own pin and pass it in.

```nix
import "${whereverSrc}/package.nix" {
  inherit pkgs;
  pnpmDepsHash = "sha256-...";   # regenerated against YOUR pin
}
```

## The unit

```nix
{ config, pkgs, ... }:
let
  # Same pin as the snippet above; repeated here so this module evaluates on its own.
  whereverSrc = pkgs.fetchFromGitHub {
    owner = "wighawag";
    repo = "wherever";
    rev = "<the rev you pin>";
    hash = "sha256-...";
  };
  wherever = import "${whereverSrc}/package.nix" { inherit pkgs; };
in
{
  # The config file. It holds no secret in this example, but rendering it through
  # sops is what makes the directory root-owned 0400 -- hence read-only to the service.
  sops.secrets."wherever/config.json" = {
    sopsFile = ./secrets/wherever.yaml;
    key = "config";
    mode = "0400";
    owner = "wherever";
  };

  # The auth token, as a file. It never reaches argv OR the environment: only the
  # PATH is in the environment, which is the point of WHEREVER_TOKEN_FILE.
  sops.secrets."wherever/token" = {
    sopsFile = ./secrets/wherever.yaml;
    key = "token";
    mode = "0400";
    owner = "wherever";
  };

  # The TLS private key, likewise. The certificate is not secret and can live anywhere.
  sops.secrets."wherever/tls-key" = {
    sopsFile = ./secrets/wherever.yaml;
    key = "tlsKey";
    mode = "0400";
    owner = "wherever";
  };

  users.users.wherever = {
    isSystemUser = true;
    group = "wherever";
    home = "/var/lib/wherever";
    # NOT createHome: `StateDirectory = "wherever"` below already creates and
    # owns /var/lib/wherever. Two mechanisms managing one path is how modes end
    # up fighting between activations.
    #
    # The ACME certificate is readable only by its own group (NixOS renders
    # /var/lib/acme/<domain> as 0750 acme:<group>), so without this the read
    # fails -- and the server now REFUSES TO START rather than silently serving
    # plaintext, so you would find out at deploy time instead of in a packet
    # capture. Drop this line if you are not using the ACME cert below.
    extraGroups = [ "acme" ];
  };
  users.groups.wherever = { };

  # ProtectSystem=strict requires every ReadWritePaths entry to EXIST at start,
  # so create the project tree rather than relying on it being there.
  systemd.tmpfiles.rules = [ "d /srv/projects 0750 wherever wherever -" ];

  systemd.services.wherever = {
    description = "wherever - remote control server for the pi coding agent";
    wantedBy = [ "multi-user.target" ];
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];

    serviceConfig = {
      # No secrets on the command line. Every one of them arrives by path or by env.
      ExecStart = "${wherever}/bin/wherever start --host 0.0.0.0 --port 31415";

      User = "wherever";
      Group = "wherever";
      Restart = "on-failure";

      # Everything the server WRITES lives here; systemd creates it 0700 and it
      # survives activations. This is also the complete backup set.
      StateDirectory = "wherever";
      StateDirectoryMode = "0700";
      # StateDirectory only creates the top level.
      ExecStartPre = "${pkgs.coreutils}/bin/mkdir -p /var/lib/wherever/agent";

      # The memory backstop `wherever install` bakes in, expressed declaratively.
      MemoryHigh = "1G";
      MemoryMax = "1500M";

      # Hardening.
      NoNewPrivileges = true;
      PrivateTmp = true;
      ProtectSystem = "strict";
      # StateDirectory already implies /var/lib/wherever is writable; the project
      # tree does not. The leading `-` makes a missing path non-fatal, which
      # matters because a strict unit REFUSES TO START on an absent entry.
      ReadWritePaths = [ "-/srv/projects" ];
    };

    environment = {
      # Rendered config, read-only to this service. The server never writes here.
      # NOTE this directory holds the OTHER two secrets as well, since they share
      # the `wherever/` prefix. If you would rather the config dir contain
      # exactly one file, name the others `wherever-token` / `wherever-tls-key`
      # so they land beside it rather than inside it.
      # /run/secrets is re-created per activation; that is safe here only because
      # the server re-resolves this path on every read instead of holding a handle.
      WHEREVER_CONFIG_DIR = "/run/secrets/wherever";
      # Everything written: drafts.json, and certs/ if TLS is auto-generated.
      WHEREVER_STATE_DIR = "/var/lib/wherever";

      # The token, by PATH. Nothing secret is in argv, and nothing secret is in
      # this environment block either -- only the path to the 0400 file.
      WHEREVER_TOKEN_FILE = config.sops.secrets."wherever/token".path;

      # TLS material at absolute paths, resolved independently of each other and
      # of any home directory: the key comes from sops, the certificate from ACME.
      WHEREVER_SSL_KEY = config.sops.secrets."wherever/tls-key".path;
      WHEREVER_SSL_CERT = "/var/lib/acme/box.example.com/fullchain.pem";

      # The agent's own directory (sessions, models.json, settings.json). This is
      # where the transcripts live -- see "What to back up" below; it is NOT
      # created by StateDirectory, so create it explicitly.
      PI_CODING_AGENT_DIR = "/var/lib/wherever/agent";
      HOME = "/var/lib/wherever";
    };
  };
}
```

## Why not `wherever install`

`install` writes `~/.config/systemd/user/wherever.service` (or `/etc/systemd/system/...`) and runs `systemctl enable --now`. On NixOS that file is not managed by your configuration, will not be rebuilt with the system, and duplicates a unit the module above already declares. It also bakes server flags into `ExecStart` verbatim, which is how a token ends up readable in `ps`. Use it on a laptop; do not use it here.

## Checklist for a first deployment

- [ ] `WHEREVER_CONFIG_DIR` points at the rendered config; the service user can read it and does not need to write it.
- [ ] `WHEREVER_STATE_DIR` matches `StateDirectory` and is writable by the service user.
- [ ] The token arrives via `WHEREVER_TOKEN_FILE` (or `WHEREVER_TOKEN`), never `--token`. Verify with `ps -ef | grep wherever` after the service starts: the secret must not be there.
- [ ] The unit ordering guarantees sops has decrypted before the service starts. If the token file is not there, the server **exits non-zero** rather than starting unauthenticated, so a failed start here is the guard working.
- [ ] `systemctl show wherever -p MemoryMax` does not report `infinity` (see the memory-limit caveat in the README).
- [ ] The server is actually serving **https**, not plaintext. `curl -k https://<host>:31415/health` should succeed and `curl http://<host>:31415/health` should not. (Since the TLS-load failure is now fatal, a service that starts at all has loaded its certificate — but check the scheme once.)
- [ ] If you are migrating an existing install rather than starting fresh, **copy `~/.wherever/drafts.json` into the new state directory before first start**. Saved drafts are not migrated automatically, and the old file is neither read nor deleted, so an unmigrated deployment simply shows an empty drafts list.
- [ ] Check the folder browser against a real project path. `/check-path` and `/autocomplete-path` are scoped to `$HOME`, which for a service user is the state directory and **not** where the projects are; those two endpoints may answer `403` for every project folder. Unverified against a running service — see `work/notes/observations/check-path-and-autocomplete-scoped-to-home-block-system-service-project-dirs.md`. Pointing `HOME` at a parent of the project tree is the workaround if it bites.

## What to back up

Be careful with the distinction here, because getting it wrong loses data silently.

**What wherever itself writes into `WHEREVER_STATE_DIR`** is a short list:

| Path | What | Backup? |
| --- | --- | --- |
| `<state>/drafts.json` | Saved drafts: messages the user explicitly chose to keep. The only copy. | **Yes** |
| `<state>/certs/localhost.key`, `<state>/certs/localhost.crt` | The auto-generated self-signed pair, written only when the key and cert are **not both** supplied. Regenerable. | No |

**But the state directory in the example above holds more than that**, because the example points `PI_CODING_AGENT_DIR` and `HOME` inside it, and those are written by pi and by other tools rather than by wherever:

| Path | What | Backup? |
| --- | --- | --- |
| `<state>/agent/sessions/**.jsonl` | **Every conversation transcript.** Written by the pi SDK, not by wherever, which is exactly why it is easy to leave out of a backup set derived from "what does wherever write". Usually the most valuable data on the box. | **Yes** |
| `<state>/agent/{models,settings,auth}.json` | Agent configuration and provider credentials. | **Yes** (and treat as secret) |
| `<state>/.local/share/memonaut/index.db` | The conversation-search index, written by the `memonaut` child process (which inherits `HOME`). Rebuildable from the transcripts with `recall index`. | No |

The simple rule for this layout: **back up the whole of `/var/lib/wherever` except `certs/` and `.local/share/memonaut/`.**

Uploads are in neither list: they go to `os.tmpdir()` by default, or to `<session cwd>/.wherever/uploads` with `uploads.type: "session"`, or to `uploads.dir` with `uploads.type: "custom"`. None of those is under the config or state directory, so `ReadWritePaths` has to cover the project folders regardless.
