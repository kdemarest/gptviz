#!/usr/bin/env bash
set -euo pipefail

if [[ "$(basename "$PWD")" != "gptviz" ]]; then
  echo "Run this from inside gptviz/ (cd gptviz && bash watch-runbash.sh)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VAULT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CMD_FILE="$SCRIPT_DIR/RunBash.ai"
OUT_FILE="$SCRIPT_DIR/RunBash.log"
LAST_FILE="$SCRIPT_DIR/RunBash.last.log"
TMP_FILE="$SCRIPT_DIR/RunBash.last.tmp"
HEARTBEAT_FILE="$SCRIPT_DIR/.runbash-watcher.heartbeat"

if ! command -v inotifywait >/dev/null 2>&1; then
  echo "Missing dependency: inotifywait (install with: pkg install inotify-tools)" >&2
  exit 1
fi

touch "$CMD_FILE" "$OUT_FILE" "$LAST_FILE"

beat() {
  date +%s > "$HEARTBEAT_FILE" 2>/dev/null || true
}

extract_command() {
  local raw cmd
  raw="$(cat "$CMD_FILE" 2>/dev/null || true)"
  cmd="$(printf '%s\n' "$raw" | sed 's/\r$//' | awk 'NF && $1 !~ /^#/{print; exit}')"
  cmd="${cmd#${cmd%%[![:space:]]*}}"
  cmd="${cmd%${cmd##*[![:space:]]}}"
  printf '%s' "$cmd"
}

run_command() {
  local cmd="$1"
  local req ts_start ts_end rc

  req="REQ-$(date -u +"%Y%m%dT%H%M%SZ")-$$"
  ts_start="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  {
    echo ""
    echo "=== BEGIN $req ==="
    echo "time_start: $ts_start"
    echo "command: $cmd"
    echo "output:"
  } > "$TMP_FILE"

  set +e
  case "$cmd" in
    "gptviz build")
      (cd "$SCRIPT_DIR" && bash build.sh) >> "$TMP_FILE" 2>&1
      rc=$?
      ;;
    "gptviz smoke")
      (cd "$SCRIPT_DIR" && bash build.sh) >> "$TMP_FILE" 2>&1
      rc=$?
      if [ $rc -eq 0 ]; then
        echo "Built gptviz plugin." >> "$TMP_FILE"
      fi
      ;;
    "gptviz tail-log")
      if [ -f "$VAULT_ROOT/gptviz.log" ]; then
        tail -n 80 "$VAULT_ROOT/gptviz.log" >> "$TMP_FILE" 2>&1
        rc=0
      else
        echo "gptviz.log not found" >> "$TMP_FILE"
        rc=1
      fi
      ;;
    *)
      echo "Unknown command: $cmd" >> "$TMP_FILE"
      echo "Supported commands: gptviz build | gptviz smoke | gptviz tail-log" >> "$TMP_FILE"
      rc=2
      ;;
  esac
  set -e

  ts_end="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  {
    echo "exit_code: $rc"
    echo "time_end: $ts_end"
    echo "=== END $req ==="
  } >> "$TMP_FILE"

  mv "$TMP_FILE" "$LAST_FILE"
  cat "$LAST_FILE" >> "$OUT_FILE"
}

process_file() {
  local cmd
  beat
  cmd="$(extract_command)"
  if [[ -z "$cmd" ]]; then
    return
  fi
  run_command "$cmd"
}

beat
process_file

echo "Watching $CMD_FILE"
while true; do
  inotifywait -q -e close_write "$CMD_FILE" >/dev/null
  process_file
done