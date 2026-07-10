#!/bin/sh
set -eu

cd /app

DEPS_STAMP="node_modules/.optra-web-deps.stamp"

needs_install() {
  if [ ! -d node_modules/next ]; then
    return 0
  fi

  if [ ! -d node_modules/@repo/ui ]; then
    return 0
  fi

  if [ ! -f "$DEPS_STAMP" ]; then
    return 0
  fi

  for file in \
    package.json \
    bun.lock \
    turbo.json \
    apps/web/package.json \
    packages/ui/package.json
  do
    if [ "$file" -nt "$DEPS_STAMP" ]; then
      return 0
    fi
  done

  return 1
}

if needs_install; then
  bun install --frozen-lockfile --filter './' --filter '@repo/web' --filter '@repo/ui'
  mkdir -p node_modules
  touch "$DEPS_STAMP"
fi

cd /app/apps/web
exec bun run dev
