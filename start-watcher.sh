#!/usr/bin/env bash
set -euo pipefail

if [[ "$(basename "$PWD")" != "gptviz" ]]; then
  echo "Run this from inside gptviz/ (cd gptviz && bash start-watcher.sh)." >&2
  exit 1
fi

if ! command -v inotifywait >/dev/null 2>&1; then
  echo "Missing inotifywait. Install inotify-tools first." >&2
  echo "On Termux: pkg install inotify-tools" >&2
  exit 1
fi

PID_FILE=".watcher.pid"
OUT_LOG=".watcher.out.log"

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "gptviz watcher already running (PID $old_pid)."
    echo "Log: $OUT_LOG"
    exit 0
  fi
fi

nohup bash -lc "cd '$PWD' && bash watch-runbash.sh" >> "$OUT_LOG" 2>&1 < /dev/null &
new_pid=$!
echo "$new_pid" > "$PID_FILE"

echo "Started gptviz watcher (PID $new_pid)."
echo "PID file: $PID_FILE"
echo "Log: $OUT_LOG"