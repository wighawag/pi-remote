#!/usr/bin/env bash
# Recompute `pnpmDepsHash` in package.nix from the CURRENT pnpm-lock.yaml.
#
# WHY THIS EXISTS: `pnpm.fetchDeps` is a fixed-output derivation, so its hash
# pins the resolved dependency set. Change pnpm-lock.yaml without changing the
# hash and Nix does not complain -- it resolves the dependency derivation by the
# old hash straight out of the store, and the build succeeds against the WRONG
# dependencies. That silent-wrong-answer is why this is a script plus a CI check
# (nix/check-pnpm-deps-hash.sh), not a sentence in a README.
#
# Usage:  ./nix/update-pnpm-deps-hash.sh        (from the repo root)
#         nix run .#update-pnpm-deps-hash
set -euo pipefail

repo_root=${WHEREVER_REPO_ROOT:-$PWD}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
package_nix="$repo_root/package.nix"

if [[ ! -f "$package_nix" ]]; then
  echo "error: $package_nix not found. Run this from the repository root." >&2
  exit 1
fi

echo "==> Computing the pnpm dependency-set hash (this fetches from the npm registry)..."
got=$("$here/compute-pnpm-deps-hash.sh" "$repo_root")

# Match ANY quoted value, not just a well-formed sha256- one: the point of
# reading it is to find the line to rewrite, and a placeholder
# (lib.fakeHash, "", a sha512-) is exactly when this script is most needed.
# `|| true` on every grep pipeline: under `set -o pipefail` a non-matching grep
# fails the pipeline, and `set -e` would exit here -- BEFORE the explicit
# not-found branch below could report anything. That is how the first version of
# this script exited 1 with no message at all.
current=$(grep -oE 'pnpmDepsHash \? "[^"]*"' "$package_nix" | head -n1 | sed 's/.*"\(.*\)"/\1/' || true)

if ! grep -qE 'pnpmDepsHash \? "[^"]*"' "$package_nix"; then
  # Do NOT print "updated" after a sed that matched nothing. A silent no-op that
  # reports success is the same class of failure this whole mechanism exists to
  # prevent: the operator believes the hash was regenerated when it was not.
  echo "error: could not find a 'pnpmDepsHash ? \"...\"' line in $package_nix." >&2
  echo "       The computed hash is: $got" >&2
  echo "       Set it by hand, or restore the line to the expected form." >&2
  exit 1
fi

if [[ "$current" == "$got" ]]; then
  echo "==> pnpmDepsHash is already up to date ($got)."
  exit 0
fi

sed -i "s|pnpmDepsHash ? \"$current\"|pnpmDepsHash ? \"$got\"|" "$package_nix"

# Verify the rewrite actually landed rather than trusting sed's exit status,
# which is 0 whether or not the pattern matched.
verify=$(grep -oE 'pnpmDepsHash \? "[^"]*"' "$package_nix" | head -n1 | sed 's/.*"\(.*\)"/\1/' || true)
if [[ "$verify" != "$got" ]]; then
  echo "error: rewrite of $package_nix did not take effect (still '$verify')." >&2
  echo "       The computed hash is: $got -- set it by hand." >&2
  exit 1
fi

echo "==> pnpmDepsHash updated in package.nix"
echo "    old: $current"
echo "    new: $got"
echo "    Commit package.nix together with pnpm-lock.yaml."
