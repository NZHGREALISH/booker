#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p logs

timestamp="$(date '+%Y-%m-%d_%H-%M-%S')"
log_file="logs/${timestamp}.log"

echo "Saving log to ${log_file}"
npm run start:default-chrome 2>&1 | tee "${log_file}"
