#!/usr/bin/env bash
# Nightly entrypoint for cron: run the daily aggregation inside Docker.
# cron has a minimal environment, so set an explicit PATH and cd into the repo.
set -euo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

cd "$(dirname "$0")/.."

LOG_DIR="logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/daily-$(date +%F).log"

{
  echo "===== $(date -Is) starting nightly daily run ====="
  # `run` auto-starts the db dependency (compose waits for its healthcheck).
  docker compose run --rm app npm run daily
  echo "===== $(date -Is) finished (exit $?) ====="
} >>"$LOG_FILE" 2>&1
