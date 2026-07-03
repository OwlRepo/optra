# syntax=docker/dockerfile:1
# Web app: Next.js 14
# Targets: dev (HMR, bind-mount source) | prod (standalone image)

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

# --- dev target: run next dev with bind-mounted source ---
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/ ./packages/

# Build packages only (web depends on types/ai/ui at type + runtime level)
RUN bunx turbo run build --filter=@repo/types --filter=@repo/db --filter=@repo/ai --filter=@repo/ui || true

WORKDIR /app

# Next dev with polling for reliable file watch in Docker (macOS/Windows)
ENV WATCHPACK_POLLING=true
ENV CHOKIDAR_USEPOLLING=true

EXPOSE 3000

ENTRYPOINT ["sh", "-c", "cd /app && (test -d node_modules/next || bun install) && cd apps/web && exec bun run dev"]

# --- prod target: build, then stage standalone output ---
FROM base AS prod
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN bunx turbo run build --filter=@repo/web...

RUN cp -r /app/apps/web/public /app/prod-public && \
    cp -r /app/apps/web/.next/standalone /app/prod-standalone && \
    cp -r /app/apps/web/.next/static /app/prod-static

# --- runner: slim final image, standalone server only ---
FROM oven/bun:1.2.22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=prod /app/prod-public ./apps/web/public
COPY --from=prod --chown=nextjs:nodejs /app/prod-standalone ./
COPY --from=prod --chown=nextjs:nodejs /app/prod-static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD ["sh", "-c", "wget -q -O /dev/null \"http://127.0.0.1:${PORT:-3000}/\" || exit 1"]

CMD ["bun", "run", "apps/web/server.js"]
