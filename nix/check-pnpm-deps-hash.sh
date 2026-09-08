#!/usr/bin/env bash
# CI guard: FAIL LOUDLY when package.nix's `pnpmDepsHash` no longer matches what
# pnpm-lock.yaml actually resolves to.
#
# WHY THIS IS NOT "just run nix build and see if it fails": a build CAN'T BE
# RELIED ON to fail. The dependency derivation is FIXED-OUTPUT, so Nix addresses
# it by the pinned hash; if an output with that hash is already in the local
# store (or available from a substituter) the fetch never runs, and a stale hash
# builds happily against the PREVIOUS lockfile's dependency set and reports
# success. (Verified locally: adding a dependency to pnpm-lock.yaml without
# touching the hash left a naive `nix build` check green.) On a genuinely COLD
# store the fetch does run and the build fails with a hash mismatch -- so a
# fresh CI runner would usually catch it -- but that is a property of the
# runner's cache state, not of the check. This recomputes the hash from the
# current lockfile and compares, which is correct regardless of store state and
# reports the two values instead of a raw mismatch.
#
# Usage:  ./nix/check-pnpm-deps-hash.sh
# Exit:   0 = matches, 1 = stale (or the fetch failed).
set -euo pipefail

repo_root=${WHEREVER_REPO_ROOT:-$PWD}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if [[ ! -f "$repo_root/package.nix" ]]; then
  echo "error: package.nix not found. Run this from the repository root." >&2
  exit 1
fi

echo "==> Recomputing the dependency-set hash from pnpm-lock.yaml..."
actual=$("$here/compute-pnpm-deps-hash.sh" "$repo_root")

pinned=$(grep -oE 'pnpmDepsHash \? "sha256-[A-Za-z0-9+/=]+"' "$repo_root/package.nix" | sed 's/.*"\(.*\)"/\1/')

if [[ -z "$pinned" ]]; then
  echo "error: could not read pnpmDepsHash out of $repo_root/package.nix" >&2
  exit 1
fi

if [[ "$pinned" == "$actual" ]]; then
  echo "==> OK: pnpmDepsHash matches the current pnpm-lock.yaml ($actual)."
  exit 0
fi

cat >&2 <<EOF

  ============================================================
  STALE pnpmDepsHash

  pnpm-lock.yaml resolves to a different dependency set than
  package.nix pins.

    pinned in package.nix: $pinned
    actual from lockfile:  $actual

  A plain build cannot be relied on to catch this: Nix resolves
  the fixed-output dependency derivation by hash, so with that
  output already in the store (or on a substituter) it silently
  reuses the OLD lockfile's dependencies and succeeds.

  Fix:  ./nix/update-pnpm-deps-hash.sh
        git add package.nix
  ============================================================

EOF
exit 1
