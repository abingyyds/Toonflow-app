#!/bin/sh
set -eu

DATA_DIR="${TOONFLOW_DATA_DIR:-/app/data}"
SEED_DIR="/app/data-seed"

mkdir -p "$DATA_DIR"

if [ -d "$SEED_DIR" ]; then
  for entry in assets modelPrompt models serve skills vendor web version.txt; do
    if [ -e "$SEED_DIR/$entry" ] && [ ! -e "$DATA_DIR/$entry" ]; then
      cp -a "$SEED_DIR/$entry" "$DATA_DIR/$entry"
    fi
  done
fi

exec "$@"
