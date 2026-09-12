#!/usr/bin/env bash
set -euo pipefail

if [[ "$(basename "$PWD")" != "gptviz" ]]; then
  echo "Run this from inside gptviz/ (cd gptviz && bash smoke.sh)." >&2
  exit 1
fi

INPUT="${1:-${GPTVIZ_SMOKE_INPUT:-assembled-plugin.js}}"
SMOKE_LOG="${GPTVIZ_SMOKE_LOG:-smoke.log}"

mkdir -p "$(dirname "$SMOKE_LOG")" 2>/dev/null || true
exec > >(tee -a "$SMOKE_LOG") 2>&1

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] smoke start input=$INPUT"

if [[ ! -f "$INPUT" ]]; then
  echo "Smoke failed: bundle not found: $INPUT" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Smoke failed: node not found in PATH." >&2
  exit 1
fi

node --check "$INPUT"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] smoke done input=$INPUT"
