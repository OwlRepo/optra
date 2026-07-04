#!/bin/sh
set -eu

cd /app

if [ ! -d node_modules/@nestjs/core ]; then
  bun install --frozen-lockfile --filter './' --filter '@repo/api' --filter '@repo/ai' --filter '@repo/db'
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
