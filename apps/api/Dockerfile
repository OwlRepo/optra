# syntax=docker/dockerfile:1
# API app: NestJS 10
# Targets: dev (watch mode, bind-mount source) | prod (standalone image)

FROM oven/bun:1.2.22-alpine AS base
WORKDIR /app

# --- deps stage: install workspace deps ---
FROM base AS deps
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/types/package.json ./packages/types/
COPY packages/db/package.json ./packages/db/
COPY packages/ai/package.json ./packages/ai/
COPY packages/ui/package.json ./packages/ui/
RUN bun install --frozen-lockfile

# --- dev target: run nest start --watch with bind-mounted source ---
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/ ./packages/

# Build packages only (skip db:push during image build; done by entrypoint)
RUN bunx turbo run build --filter=@repo/types --filter=@repo/db --filter=@repo/ai || true

WORKDIR /app

# Chokidar polling for reliable watch in Docker (macOS/Windows)
ENV CHOKIDAR_USEPOLLING=true
ENV CHOKIDAR_INTERVAL=500

EXPOSE 3001

# Ensure deps + workspace dist exist, run migrations, then start api dev.
# api imports runtime values from @repo/ai and @repo/db (main -> ./dist). The bind-mount
# (.:/app) hides the image-built dist, so on a fresh clone the host has none -> build them
# here (writes to the bind-mounted host, persists; turbo-cached so warm restarts are fast).
ENTRYPOINT ["sh", "-c", "cd /app && (test -d node_modules/@nestjs/core || bun install) && bunx turbo run build --filter=@repo/db --filter=@repo/ai && cd packages/db && bun run db:push && cd /app/apps/api && exec bun run dev"]

# --- prod target: build and serve ---
FROM base AS prod
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
RUN bunx turbo run build --filter=@repo/api...

WORKDIR /app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD ["sh", "-c", "wget -q -O /dev/null \"http://127.0.0.1:${PORT:-3001}/health\" || exit 1"]

CMD ["sh", "-c", "cd packages/db && bun run db:push && cd /app/apps/api && exec bun run start"]
