# syntax=docker/dockerfile:1

# Base stage with Bun
FROM oven/bun:1.1.0-alpine AS base
WORKDIR /app

# Dependencies stage
FROM base AS deps
# Copy root package files
COPY package.json bun.lockb ./
COPY apps/api/package.json ./apps/api/
COPY packages/ai/package.json ./packages/ai/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/

# Install dependencies
RUN bun install --frozen-lockfile --production=false

# Builder stage
FROM base AS builder
WORKDIR /app

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules

# Copy source
COPY . .

# Build shared packages first
WORKDIR /app/packages/types
RUN bun run build

WORKDIR /app/packages/db
RUN bun run build

WORKDIR /app/packages/ai
RUN bun run build

# Build NestJS API
WORKDIR /app/apps/api
RUN bun run build

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

# Copy built files and dependencies
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages ./packages
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules

USER nestjs

EXPOSE 3001
ENV PORT=3001

CMD ["node", "apps/api/dist/main.js"]
