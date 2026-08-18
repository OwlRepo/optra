#!/bin/sh
# Optional demo-tenant seeding at API start-up.
#
# Runs only when SEED_DEMO_DATA=true. The seeder itself is invoked with --once,
# which exits immediately if the demo workspace already exists — so this is safe
# on every boot and will never re-seed, never wipe, and never overwrite a demo
# tenant someone has since edited.
#
# Deliberately never fails the container: a seeding problem must not stop the
# API from starting. Any error is logged and swallowed.

set -u

if [ "${SEED_DEMO_DATA:-false}" != "true" ]; then
  exit 0
fi

echo "[seed-demo] SEED_DEMO_DATA=true — running demo seeder in --once mode"

if ! command -v bun >/dev/null 2>&1; then
  echo "[seed-demo] WARNING: bun not found in this image; skipping demo seed"
  exit 0
fi

cd /app || exit 0

if bun run scripts/seed/index.ts --once; then
  echo "[seed-demo] done"
else
  echo "[seed-demo] WARNING: demo seeding failed; continuing start-up anyway"
fi

exit 0
