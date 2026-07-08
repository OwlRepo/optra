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
RUN apt-get update && apt-get install -y --no-install-recommends nodejs ca-certificates \
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
RUN --mount=type=cache,id=mnemra-bun-api-v1,target=/root/.bun/install/cache,sharing=locked \
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
RUN --mount=type=cache,id=mnemra-turbo-api-v1,target=/app/.turbo,sharing=locked \
    bunx turbo run build --filter=@repo/api...

WORKDIR /app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD ["sh", "-c", "wget -q -O /dev/null \"http://127.0.0.1:${PORT:-3001}/health\" || exit 1"]

CMD ["sh", "-c", "cd packages/db && bun run db:migrate && cd /app/apps/api && exec node dist/main"]
