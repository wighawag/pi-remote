#!/usr/bin/env bash
# Measure the wherever server's memory at startup against a REAL (large)
# sessions directory, without touching the user's live agent dir or config.
#
# Usage: server/test/bench/startup-memory.sh [sessionsDir] [seconds]
#
# Points an isolated PI_CODING_AGENT_DIR at the given sessions directory via a
# symlink (read-only in practice: nothing is created unless a session is), boots
# the server on an ephemeral port with no SSL, and samples the node process's
# RSS once a second. Prints the peak and the settled value.
set -euo pipefail

SESSIONS_DIR="${1:-$HOME/.pi/agent/sessions}"
DURATION="${2:-45}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$HERE/../.." && pwd)"

TMP="$(mktemp -d /tmp/wherever-memtest-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/agent" "$TMP/config"
ln -s "$SESSIONS_DIR" "$TMP/agent/sessions"
# Same view the live service serves (default view honours these globs).
cat > "$TMP/config/config.json" <<'JSON'
{ "sessions": { "ignore": ["/tmp/**"], "readOnly": ["~/.dorfl/**", "~/.agent-runner/**"] } }
JSON

PORT=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')

cd "$SERVER_DIR"
# Prefer the BUILT entry point: that is what the service runs, and the tsx
# loader alone costs ~200 MB of RSS, which would drown the numbers we are after.
if [ -f dist/index.js ]; then
  ENTRY=(node dist/index.js)
  echo "entry: dist/index.js (built)"
else
  ENTRY=(node --import tsx src/index.ts)
  echo "entry: src/index.ts via tsx (NOTE: adds ~200 MB of loader overhead; run 'pnpm build' for realistic numbers)"
fi
PI_CODING_AGENT_DIR="$TMP/agent" \
WHEREVER_CONFIG_DIR="$TMP/config" \
  "${ENTRY[@]}" start --port "$PORT" --host 127.0.0.1 --no-ssl \
  > "$TMP/server.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true; rm -rf "$TMP"' EXIT

# The tsx loader re-execs node into a CHILD, so the interesting RSS is the whole
# process tree, not $PID alone.
tree_rss() {
  local root=$1 total=0 pid
  local pids="$root"
  local frontier="$root"
  while [ -n "$frontier" ]; do
    local next=""
    for pid in $frontier; do
      local kids
      kids=$(pgrep -P "$pid" 2>/dev/null | tr '\n' ' ')
      next="$next $kids"
    done
    frontier=$(echo "$next" | xargs echo)
    pids="$pids $frontier"
  done
  for pid in $pids; do
    local rss
    rss=$(awk '/VmRSS/{print $2}' "/proc/$pid/status" 2>/dev/null || echo 0)
    total=$((total + ${rss:-0}))
  done
  echo "$total"
}

# Sample 5x/second: a GC-driven RSS spike during the scan is short-lived and a
# 1 Hz sampler walks straight past it.
peak=0
samples=$((DURATION * 5))
for i in $(seq 1 "$samples"); do
  sleep 0.2
  kill -0 "$PID" 2>/dev/null || break
  rss=$(tree_rss "$PID")
  [ "$rss" -gt "$peak" ] && peak=$rss
  if [ $((i % 5)) -eq 0 ]; then
    printf 't=%3ss rss=%s MB (peak %s MB)\n' "$((i / 5))" "$((rss / 1024))" "$((peak / 1024))"
  fi
done

echo "----"
echo "sessions dir: $SESSIONS_DIR ($(du -sh -L "$SESSIONS_DIR" | cut -f1))"
echo "peak RSS: $((peak / 1024)) MB"
final=$(tree_rss "$PID")
echo "final RSS: $((final / 1024)) MB"
echo "---- server log ----"
cat "$TMP/server.log"
