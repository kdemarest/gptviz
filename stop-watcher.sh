#!/usr/bin/env bash
set -euo pipefail

if [[ "$(basename "$PWD")" != "gptviz" ]]; then
  echo "Run this from inside gptviz/ (cd gptviz && bash stop-watcher.sh)." >&2
  exit 1
fi

PID_FILE=".watcher.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "gptviz watcher: no PID file"
  exit 0
fi

pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "$pid" ]]; then
  echo "gptviz watcher: empty PID file; removing"
  rm -f "$PID_FILE"
  exit 0
fi

if kill -0 "$pid" 2>/dev/null; then
  kill "$pid" || true
  for _ in {1..20}; do
    if kill -0 "$pid" 2>/dev/null; then
      sleep 0.1
    else
      break
    fi
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "gptviz watcher: process $pid did not exit; sending SIGKILL"
    kill -9 "$pid" || true
  fi
  echo "Stopped gptviz watcher process $pid"
else
  echo "gptviz watcher: process $pid is not running"
fi

rm -f "$PID_FILE"