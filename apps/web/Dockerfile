# syntax=docker/dockerfile:1
# Web app: Next.js 14
# Targets: dev (HMR, bind-mount source) | runner (standalone image)

FROM oven/bun:1.2.22-alpine AS base
WORKDIR /app
RUN apk add --no-cache nodejs

# --- deps stage: install workspace deps ---
FROM base AS deps
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/types/package.json ./packages/types/
COPY packages/db/package.json ./packages/db/
COPY packages/ai/package.json ./packages/ai/
COPY packages/ui/package.json ./packages/ui/
RUN --mount=type=cache,id=mnemra-bun-web-v1,target=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile --filter './' --filter '@repo/web' --filter '@repo/ui'

# --- dev target: run next dev with bind-mounted source ---
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/ ./packages/
COPY docker/web-dev-entrypoint.sh ./docker/web-dev-entrypoint.sh

WORKDIR /app

# Next dev with polling for reliable file watch in Docker (macOS/Windows)
ENV WATCHPACK_POLLING=true
ENV CHOKIDAR_USEPOLLING=true

EXPOSE 3000

ENTRYPOINT ["sh", "/app/docker/web-dev-entrypoint.sh"]

# --- prod target: build, then stage standalone output ---
FROM base AS prod
# NEXT_PUBLIC_* must be present at BUILD time — Next inlines it into the client bundle.
# Passed via build.args in docker-compose.prod.yml (web.build.args.NEXT_PUBLIC_API_URL).
ARG NEXT_PUBLIC_API_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN --mount=type=cache,id=mnemra-turbo-web-v1,target=/app/.turbo,sharing=locked \
    bunx turbo run build --filter=@repo/web...

RUN mkdir -p /app/prod-public && \
    if [ -d /app/apps/web/public ]; then cp -r /app/apps/web/public/. /app/prod-public/; fi && \
    cp -r /app/apps/web/.next/standalone /app/prod-standalone && \
    cp -r /app/apps/web/.next/static /app/prod-static

# --- runner: slim final image, standalone server only ---
FROM oven/bun:1.2.22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache nodejs
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=prod /app/prod-public ./apps/web/public
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=prod --chown=nextjs:nodejs /app/prod-standalone ./
COPY --from=prod --chown=nextjs:nodejs /app/prod-static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD ["sh", "-c", "wget -q -O /dev/null \"http://127.0.0.1:${PORT:-3000}/\" || exit 1"]

CMD ["node", "server.js"]
