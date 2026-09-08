#!/usr/bin/env bash
# Print the hash of the dependency set that the CURRENT pnpm-lock.yaml resolves
# to. Shared by update-pnpm-deps-hash.sh and check-pnpm-deps-hash.sh.
#
# It deliberately asks for the deps derivation with an EMPTY hash. That is not a
# trick to read a nicer error message: it is the only way to force the fetch to
# actually RUN. A fixed-output derivation is addressed by its hash, so building
# it with the pinned hash resolves straight out of the store whenever that hash
# has been seen before -- which is precisely the stale-hash case we are trying to
# detect, and why "just build it and see if it fails" does NOT work as a check.
set -euo pipefail

repo_root=${1:?usage: compute-pnpm-deps-hash.sh <repo-root>}

# `$repo_root` is interpolated as a Nix STRING, not as a bare path literal: a
# checkout under a path with a space would otherwise parse as a function
# application, and one containing a quote or `${` would be expression injection.
# The `/. + "..."` form keeps it a path for `import` while quoting the value.
log=$(
  nix build --no-link --impure --expr "
    let
      root = /. + \"$repo_root\";
      pkgs = import (root + \"/nix/pkgs-for-hash-update.nix\") { };
    in
    (import (root + \"/package.nix\") { inherit pkgs; pnpmDepsHash = \"\"; }).pnpmDeps
  " 2>&1 || true
)

# `|| true` matters: under `set -o pipefail` a grep that matches nothing fails the
# whole pipeline, and `set -e` would then kill the script before the explicit
# "could not compute" branch below ever ran -- turning a diagnosable failure into
# a silent exit 1.
hash=$(printf '%s\n' "$log" | grep -oE 'got: +sha256-[A-Za-z0-9+/=]+' | head -n1 | sed 's/^got: *//' || true)

if [[ -z "$hash" ]]; then
  echo "error: could not compute the dependency-set hash. Full log:" >&2
  printf '%s\n' "$log" >&2
  exit 1
fi

printf '%s\n' "$hash"
