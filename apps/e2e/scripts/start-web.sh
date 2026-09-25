#!/bin/sh
# Serve the built web app the way production does, for the browser suite.
#
# `next start` warns and is not what runs in production: next.config.js sets
# `output: 'standalone'`, and apps/web/Dockerfile ships .next/standalone plus
# the static assets and public/ copied beside it, then runs `node server.js`.
# This stages the same three things so the suite exercises the real server.
#
# Requires `bunx turbo run build --filter=@repo/web` to have run first.
set -eu

WEB_DIR="$(cd "$(dirname "$0")/../../web" && pwd)"
REPO_ROOT="$(cd "$WEB_DIR/../.." && pwd)"
STANDALONE="$WEB_DIR/.next/standalone"
# Staged outside apps/web on purpose. Run in place, server.js resolves `next`
# by walking up through apps/web/node_modules, which on a developer machine
# can hold stale partial copies; the image has exactly one node_modules at the
# root, and so does this directory.
STAGE="$(cd "$(dirname "$0")/.." && pwd)/.web-standalone"

if [ ! -f "$STANDALONE/server.js" ]; then
    echo "no standalone build at $STANDALONE - run: bunx turbo run build --filter=@repo/web" >&2
    exit 1
fi

rm -rf "$STAGE"
mkdir -p "$STAGE/.next"
cp -R "$STANDALONE/." "$STAGE/"
cp -R "$WEB_DIR/.next/static" "$STAGE/.next/static"
if [ -d "$WEB_DIR/public" ]; then
    cp -R "$WEB_DIR/public" "$STAGE/public"
fi
ln -s "$REPO_ROOT/node_modules" "$STAGE/node_modules"

cd "$STAGE"
# Loopback only: a test server has no business on the LAN.
exec env NODE_ENV=production HOSTNAME=127.0.0.1 PORT="${PORT:-3100}" node server.js
