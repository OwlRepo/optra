# syntax=docker/dockerfile:1
# API app: NestJS 10
# Targets: dev (watch mode, bind-mount source) | prod (standalone image)

# Debian-based (glibc), not -alpine: DuckDB's prebuilt native binary
# (apps/api/src/structured-query) is linked against glibc. Alpine's musl libc
# has no ld-linux-*.so.1 loader at all, and even with the libc6-compat shim
# the binding hung at dlopen instead of loading cleanly — verified empirically,
# not assumed. A real glibc base is the reliable fix, not a compatibility shim.
FROM oven/bun:1.2.22 AS base
WORKDIR /app
# ca-certificates: without it, HTTPS requests from postinstall scripts (e.g.
# DuckDB fetching its prebuilt binary from npm.duckdb.org) fail with "unable
# to get local issuer certificate" — verified via a real failed build, not
# assumed; --no-install-recommends skips it since it's only "Recommended".
#
# Debian bookworm's own "nodejs" apt package is pinned at 18.20.4 (Node ABI
# 108). duckdb@1.4.4 no longer publishes a prebuilt binary for that ABI
# (verified: npm.duckdb.org 404s for node-v108-linux-x64, but 200s for
# node-v115 [Node 20] and node-v127 [Node 22]), so bun install falls back to
# compiling from source via node-gyp — which then fails too, since this image
# has no Python. Installing Node 20.x from NodeSource instead of the Debian
# default gets an ABI duckdb actually ships a prebuilt binary for, so the
# postinstall script downloads instead of compiling — no build toolchain
# needed at all.
# procps (ps): nest start --watch uses tree-kill to restart the process on
# file change, which shells out to `ps -o pid --no-headers --ppid` on Linux —
# without it, every dev-mode hot-reload crashes the container with
# "spawn ps ENOENT" (verified against a real crash, not assumed).
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg procps \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# --- deps stage: install workspace deps ---
FROM base AS deps
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/types/package.json ./packages/types/
COPY packages/db/package.json ./packages/db/
COPY packages/ai/package.json ./packages/ai/
COPY packages/ui/package.json ./packages/ui/
RUN --mount=type=cache,id=optra-bun-api-v1,target=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile --filter './' --filter '@repo/api' --filter '@repo/ai' --filter '@repo/db'

# --- dev target: run nest start --watch with bind-mounted source ---
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/ ./packages/
COPY docker/api-dev-entrypoint.sh ./docker/api-dev-entrypoint.sh

WORKDIR /app

# Chokidar polling for reliable watch in Docker (macOS/Windows)
ENV CHOKIDAR_USEPOLLING=true
ENV CHOKIDAR_INTERVAL=500

EXPOSE 3001

ENTRYPOINT ["sh", "/app/docker/api-dev-entrypoint.sh"]

# --- prod target: build and serve ---
FROM base AS prod
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
RUN --mount=type=cache,id=optra-turbo-api-v1,target=/app/.turbo,sharing=locked \
    bunx turbo run build --filter=@repo/api...

WORKDIR /app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD ["sh", "-c", "curl -fsS -o /dev/null \"http://127.0.0.1:${PORT:-3001}/health\" || exit 1"]

CMD ["sh", "-c", "cd packages/db && bun run db:migrate && cd /app/apps/api && exec node dist/main"]
