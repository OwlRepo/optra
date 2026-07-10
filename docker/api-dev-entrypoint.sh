#!/bin/sh
set -eu

cd /app

DEPS_STAMP="node_modules/.optra-api-deps.stamp"

needs_install() {
  if [ ! -d node_modules/@nestjs/core ]; then
    return 0
  fi

  if [ ! -d node_modules/archiver ]; then
    return 0
  fi

  if [ ! -f "$DEPS_STAMP" ]; then
    return 0
  fi

  for file in \
    package.json \
    bun.lock \
    turbo.json \
    apps/api/package.json \
    apps/api/Dockerfile \
    packages/db/package.json \
    packages/ai/package.json \
    packages/types/package.json
  do
    if [ "$file" -nt "$DEPS_STAMP" ]; then
      return 0
    fi
  done

  return 1
}

if needs_install; then
  bun install --frozen-lockfile --filter './' --filter '@repo/api' --filter '@repo/ai' --filter '@repo/db'
  mkdir -p node_modules
  touch "$DEPS_STAMP"
fi

needs_build() {
  package_dir="$1"
  dist_file="$package_dir/dist/index.js"

  if [ ! -f "$dist_file" ]; then
    return 0
  fi

  if find "$package_dir/src" -type f -newer "$dist_file" | grep -q .; then
    return 0
  fi

  return 1
}

if needs_build packages/db || needs_build packages/ai; then
  bunx turbo run build --filter=@repo/db --filter=@repo/ai
fi

cd /app/packages/db
bun run db:migrate

cd /app/apps/api
exec bun run dev
