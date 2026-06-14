#!/bin/sh
# pisearch uninstaller. Removes the launcher and the MARKED PATH block from
# common shell rc files. Safe to run multiple times.

set -eu

MARK_BEGIN="# >>> pisearch >>>"
MARK_END="# <<< pisearch <<<"
LAUNCHER="$HOME/.local/bin/pisearch"

if [ -f "$LAUNCHER" ]; then
  rm -f "$LAUNCHER"
  echo "Removed launcher: $LAUNCHER"
else
  echo "No launcher at $LAUNCHER (already gone)."
fi

strip_block() {
  rc=$1
  [ -f "$rc" ] || return 0
  if ! grep -qF "$MARK_BEGIN" "$rc" 2>/dev/null; then
    return 0
  fi
  tmp=$(mktemp)
  # Drop everything between the markers, inclusive.
  awk -v b="$MARK_BEGIN" -v e="$MARK_END" '
    $0 == b {skip=1; next}
    $0 == e {skip=0; next}
    skip != 1 {print}
  ' "$rc" > "$tmp"
  # Also trim a trailing blank line left behind, harmlessly.
  cat "$tmp" > "$rc"
  rm -f "$tmp"
  echo "Removed pisearch PATH block from: $rc"
}

strip_block "$HOME/.config/fish/config.fish"
strip_block "$HOME/.zshrc"
strip_block "$HOME/.bashrc"
strip_block "$HOME/.bash_profile"
strip_block "$HOME/.profile"

echo "Done. Open a new terminal to drop the PATH change."
