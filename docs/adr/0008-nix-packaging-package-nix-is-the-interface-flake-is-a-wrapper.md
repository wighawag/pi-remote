# Nix packaging: `package.nix` is a plain function of `pkgs` and IS the interface; `flake.nix` is a thin wrapper

**Status:** accepted

Wherever is consumed by a deployment repo (`my-boxes`) that evaluates MORE THAN ONE nixpkgs pin and builds each service as `import ./services/<name>/package.nix { pkgs = <the pin it chose>; }`. If the package were only a flake output, that consumer would have to add wherever's flake as an input and would pull a THIRD nixpkgs into its closure, which is exactly what a multi-pin deployment repo is structured to avoid.

## The decision

The derivation lives in `package.nix`, a plain function whose only required argument is `pkgs`. It mentions no flakes, no inputs, and no locked nixpkgs. `flake.nix` merely calls it.

That gives two audiences one artifact each, with no duplication:

- **The consumer** imports `package.nix` with its own `pkgs`. Verified: importing it against a bare `import <fetched nixpkgs> {}` produces the SAME store path as the flake's `nix build` does, given the same nixpkgs and the same `buildVersion`. (In a real git checkout the flake additionally stamps `buildVersion` with the commit rev, which the consumer's plain import leaves at the package version, so the two differ by exactly that one build id and nothing else.)
- **Humans and CI** get `nix develop` (the toolchain) and `nix build` (a local check) from the flake.

`nodejs` and `pnpm` are function arguments defaulted to `nodejs_24` / `pnpm_10`, NOT to `pkgs.nodejs` / `pkgs.pnpm`. The consumer chooses the nixpkgs; the toolchain a given source tree builds under is a property of THIS repo (`pnpm-lock.yaml` is `lockfileVersion: 9.0`, which pnpm 11 rewrites). Both stay overridable for a consumer that knows better.

The flake's own nixpkgs pin is kept LOOSE (a branch, `nixos-26.05`, not a rev) on purpose: it only ever serves the dev shell and local builds, so tracking the branch is a feature there, while the consumer's build is unaffected by it either way.

## `devShells.default` is the first-class output, and it is the point

The unit being replaced ran `/home/wighawag/.volta/tools/image/node/24.13.1/bin/node ...` — a hardcoded, version-pinned path into a shim manager. systemd units do not source shell profiles, so a volta-shimmed binary is either pinned to a version that breaks on the next upgrade or is simply not on `PATH`. The dev shell is the same fix applied to development: the exact node + pnpm the lockfile expects, with no global installs and nothing inherited from a login shell. It also ships `openssl` (the server invokes it BY NAME to mint its fallback self-signed certificate) and `git` (the web build reads a rev to stamp a build id), because a shell that claims to be a working environment must provide what the code assumes.

## `pnpmDepsHash` is a real maintenance cost, so it gets a CI check and not a README line

`pnpm.fetchDeps` is a fixed-output derivation: its hash pins the resolved dependency set. Change `pnpm-lock.yaml` without updating the hash and Nix does not fail — it reuses the CACHED dependency set of the OLD lockfile and builds a package against dependencies nobody asked for. A silent wrong answer is a much worse failure than a broken build, so it gets machinery rather than documentation: `nix/update-pnpm-deps-hash.sh` regenerates the value, and `nix/check-pnpm-deps-hash.sh` fails loudly when it is stale (wired into CI alongside the build).

**The check cannot RELY on "run `nix build` and see if it fails", and this was confirmed the hard way.** The first version of the guard did exactly that; adding a dependency to `pnpm-lock.yaml` without touching the hash left it GREEN, because Nix addresses a fixed-output derivation by its hash and resolved the old one straight out of the store without ever running the fetch. On a genuinely COLD store the fetch does run and the build fails with a hash mismatch, so a fresh CI runner would usually catch it too — but that is a property of the runner's cache state, not of the check, and it is not something to depend on. The guard therefore RECOMPUTES the hash (by asking for the deps derivation with an empty hash, the only way to force the fetch to run) and compares it to the pinned value, which is correct regardless of store state and reports both values instead of a raw mismatch. It needs network, which is why it lives in CI and not in `nix flake check`.

## Build-shape decisions worth recording

- **Lifecycle scripts are off** (`pnpmConfigHook` installs with `--ignore-scripts`, correctly: the root `preinstall` is `npx only-allow pnpm`, which needs the network). The web app's `prepare` is a genuine build step, so `pwag` (generates the gitignored PWA icon set) and `svelte-kit sync` are invoked EXPLICITLY in `buildPhase` instead of the whole script surface being re-enabled.
- **`WHEREVER_BUILD_VERSION`** was added to `web/svelte.config.js` because it stamped the build id from `git rev-parse` and fell back to `timestamp_${Date.now()}`. With no `.git` in the sandbox that fallback makes every build a different artifact; the env var lets an out-of-tree builder state the version and stay reproducible.
- **The `src` filter is an ALLOWLIST, not a denylist.** This matters because `package.nix` is imported BY PATH (that is the whole point) as well as evaluated through the flake. The flake only ever sees git-tracked files, but a path import of a working checkout sees everything, including this repo's gitignored scratch — `tmp/` and `.kilo/` are ~160 MB between them — which would be copied into the store on every consumer build and every run of the hash scripts, and would make the two paths produce different store paths. An allowlist of the workspace members plus the root manifests also cannot rot: a new scratch directory is excluded by default rather than by someone remembering to add it.
- **The pinned `pnpmDepsHash` narrows "the consumer picks the nixpkgs" more than it may appear.** `fetcherVersion = 4` requires a nixpkgs new enough to support it, and the hash is tied to the exact `pnpm_10` patch release that produced it. Both failures are loud (an eval `throw`, or a hash mismatch) rather than silent wrong builds, and both are fixed by passing a `pnpmDepsHash` regenerated against the consumer's own pin — documented in `docs/deployment-nixos.md`.
- **The runtime tree comes from `pnpm deploy --prod` with `inject-workspace-packages` set IN THE BUILD ENVIRONMENT ONLY.** `deploy`'s `--legacy` path re-resolves every workspace project against the npm registry (no network in the sandbox, and it defeats the lockfile), while the modern path needs that setting to use the shared lockfile. Setting it in the repo's `pnpm-workspace.yaml` would change how every developer's install links workspace packages, for a build-only need; the server has no workspace dependencies, so the setting changes nothing about what is produced. Result: 176 MB with no dev toolchain, versus 477 MB when the workspace `node_modules` was pruned in place and shipped whole.
