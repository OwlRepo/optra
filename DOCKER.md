# Docker Guide

## Local Development (Hot Reload)

### Architecture
Everything runs in **Docker**: Postgres + Redis + SeaweedFS + the API + the web app.
Source is bind-mounted into the `api`/`web` containers, so edits on your host reach the running dev servers immediately — file-watch uses polling (`CHOKIDAR_USEPOLLING`/`WATCHPACK_POLLING`) so it works reliably across macOS/Windows/Linux.

**No image rebuild needed when you change code** — only when you change a `Dockerfile`, add a dependency, or change `turbo.json`.

### Start Everything

```bash
bun run docker:dev:up
# or
docker compose up -d

# This will:
# 1. Build the api/web dev images (first run only, or after a Dockerfile change)
# 2. Start Postgres + Redis + SeaweedFS, wait for them to be healthy
# 3. Start api + web containers, which each run migrations then their own dev server
```

**Services:**
- 🌐 **Web**: http://localhost:3000 (Next.js with hot reload)
- 🔌 **API**: http://localhost:3001 (NestJS with hot reload)
- 🐘 **Postgres**: localhost:54321
- 🔴 **Redis**: localhost:6379
- 🪣 **SeaweedFS S3**: http://localhost:8333
- 🗂️ **SeaweedFS Filer UI**: http://localhost:8888
- 🌱 **SeaweedFS Master UI**: http://localhost:9333
- 📦 **Default bucket**: `mnemra-documents`

### Stop Everything

```bash
bun run docker:dev:down
# or
docker compose down
```

### View Logs

```bash
# All services
bun run docker:dev:logs

# Or specific service
docker compose logs -f api
docker compose logs -f web
docker compose logs -f postgres
```

### Reset Database

```bash
# Stop everything
docker compose down

# Remove data volumes (postgres_data, redis_data, seaweedfs_data — prefixed mnemra_ per the compose `name:` pin)
docker compose down -v

# Start fresh
bun run docker:dev:up
```

---

## Production (Hetzner VPS)

### Full Containerization
Everything runs in Docker:
- Next.js app (web)
- NestJS API (api)
- PostgreSQL with pgvector
- Redis
- SeaweedFS (S3-compatible object storage)
- Caddy (reverse proxy + auto SSL)

### Deploy

**From local machine:**
```bash
# First time setup
cp .env.example .env
nano .env  # Fill in DOMAIN, passwords, API keys
cp docker/seaweedfs/s3.prod.json.example docker/seaweedfs/s3.prod.json
nano docker/seaweedfs/s3.prod.json  # Fill in real S3 credentials

# Deploy
bun run deploy:remote user@your-server-ip
```

**On server directly:**
```bash
cd /opt/mnemra
./scripts/deploy.sh
```

**Automatically on push to `main`:** see `.github/workflows/deploy.yml` — requires the deploy dir to already have `.env` and `docker/seaweedfs/s3.prod.json` in place from a prior manual deploy, plus `VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY`/`VPS_PORT` configured as GitHub Secrets. The smoke test reads `DOMAIN` from `.env`, so no domain secret is needed.

### What Happens

1. **Build multi-stage Docker images** (optimized, small)
   - Install deps → Build packages → Build apps → Copy to minimal runtime
2. **Stop old containers** (zero-downtime with health checks)
3. **Run database migrations**
4. **Start all services** — `api`/`web`/`caddy` wait on real healthchecks before the next one starts
5. **Caddy obtains SSL certificate** (automatic, from Let's Encrypt)

### Services

```bash
# Check status
docker compose -f docker-compose.prod.yml ps

# Should show:
# - postgres (healthy)
# - redis (healthy)
# - seaweedfs (healthy)
# - api (healthy)
# - web (healthy)
# - caddy (running)
```

### Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Web app
docker compose -f docker-compose.prod.yml logs -f web

# API
docker compose -f docker-compose.prod.yml logs -f api

# Caddy (SSL, reverse proxy)
docker compose -f docker-compose.prod.yml logs -f caddy
```

### Update Production

```bash
# From local machine
bun run deploy:remote user@your-server-ip

# This:
# 1. Syncs code to server
# 2. Rebuilds Docker images
# 3. Restarts services with new code

# Or push to main and let GitHub Actions do it
```

### Rollback

```bash
# On server
cd /opt/mnemra

# Stop current version
docker compose -f docker-compose.prod.yml down

# Checkout previous commit
git checkout HEAD~1

# Redeploy
./scripts/deploy.sh
```

---

## Docker Images

### Web App (Next.js)

Multi-stage build (`base` → `deps` → `dev` → `prod`):
1. **deps**: Install all dependencies
2. **dev**: bind-mounted source, `next dev`, polling-based hot reload
3. **prod**: builds shared packages + Next.js standalone output, then stages into a slim final `runner` layer (non-root, no `node_modules`, no source)

**Size**: ~200MB (optimized standalone build)

### API (NestJS)

Multi-stage build (`base` → `deps` → `dev` → `prod`):
1. **deps**: Install dependencies
2. **dev**: bind-mounted source, `nest start --watch`, polling-based hot reload
3. **prod**: builds shared packages + NestJS, minimal runtime with compiled JS

**Size**: ~150MB

### Build Images Manually

```bash
# Web (dev target)
docker build -f apps/web/Dockerfile --target dev -t mnemra-web:dev .

# Web (prod target)
docker build -f apps/web/Dockerfile --target prod -t mnemra-web:prod .

# API
docker build -f apps/api/Dockerfile --target prod -t mnemra-api:prod .
```

---

## Networks

### Local Development
```
Host machine (:3000, :3001, :54321, :6379, :8333/:8888/:9333)
    ↓ published ports
Docker default network (api, web, postgres, redis, seaweedfs — reachable by service name inside the network)
```

### Production
```
Internet
   │
Caddy (:80, :443) ← SSL termination
   │
   ├─ web (:3000) ← internal network
   └─ api (:3001) ← internal network
          │
          ├─ postgres (:5432) ← internal only
          ├─ redis (:6379) ← internal only
          └─ seaweedfs (:8333, :8888, :9333) ← internal only
```

**Networks:**
- `web`: Caddy ↔ apps (public-facing)
- `internal`: apps ↔ database/redis (private)

Database, Redis, and SeaweedFS **not exposed** to internet.

### Storage Config

Local development:
- `S3_ENDPOINT=http://localhost:8333` (host) / `http://seaweedfs:8333` (inside `api`/`web` containers)
- `S3_BUCKET=mnemra-documents`
- credentials come from `docker/seaweedfs/s3.json`

Production:
- `S3_ENDPOINT=http://seaweedfs:8333`
- prod must provide `docker/seaweedfs/s3.prod.json` with real credentials matching `.env` — copy it from the committed `docker/seaweedfs/s3.prod.json.example` template before first deploy (the file itself is gitignored, same as `.env`)

---

## Volumes

### Local Development

```bash
# List volumes
docker volume ls

# Inspect (name: mnemra pin in docker-compose.yml means these are mnemra_-prefixed
# regardless of the on-disk folder name)
docker volume inspect mnemra_postgres_data
docker volume inspect mnemra_redis_data

# Backup
docker run --rm -v mnemra_postgres_data:/data \
  -v $(pwd):/backup alpine tar czf /backup/postgres-backup.tar.gz /data
```

### Production

```bash
# List
docker volume ls | grep mnemra

# Backup Postgres
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U postgres mnemra | gzip > backup-$(date +%Y%m%d).sql.gz

# Restore
gunzip < backup.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres mnemra
```

---

## Troubleshooting

### Build fails

```bash
# Clear Docker cache
docker builder prune -af

# Rebuild without cache
docker compose -f docker-compose.prod.yml build --no-cache
```

### Container won't start

```bash
# Check logs
docker compose logs api

# Check if port is in use
sudo lsof -i :3001

# Restart specific service
docker compose restart api
```

### Out of disk space

```bash
# Clean up unused images
docker image prune -a

# Clean up unused volumes
docker volume prune

# Clean up everything
docker system prune -a --volumes
```

### Database connection error

```bash
# Check if postgres is healthy
docker compose ps

# Test connection
docker compose exec postgres psql -U postgres -d mnemra -c "SELECT 1"

# Check env vars
docker compose exec api env | grep DATABASE_URL
```

---

## Performance

### Local Development

**Hot reload speed:**
- Next.js: ~100-500ms (Fast Refresh)
- NestJS: ~1-2s (incremental TypeScript compilation)

Both run inside containers now, with polling-based file watch (`CHOKIDAR_USEPOLLING`/`WATCHPACK_POLLING`) instead of native OS filesystem events — slightly slower to detect a change than a bare-metal host process, but still sub-second in practice, and no image rebuild is triggered by a source edit.

### Production

**Image optimization:**
- Multi-stage builds → smaller images
- Bun for faster installs
- Next.js standalone output → minimal runtime

**Resource limits** (edit docker-compose.prod.yml):
```yaml
services:
  web:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
```

---

## Security

### Production Checklist

- [x] Apps run as non-root users (nextjs, nestjs)
- [x] Database not exposed to internet
- [x] Redis not exposed to internet
- [x] SSL auto-managed by Caddy
- [x] Security headers configured (Caddyfile)
- [x] Secrets in .env (not in images)
- [x] `api`/`web` have real HEALTHCHECKs; `web`/`caddy` wait on them before starting
- [ ] Regular image updates (`docker compose pull`)
- [ ] Database backups automated (GitHub Actions deploy does a pre-deploy backup; no separate schedule yet)
- [ ] Firewall configured (UFW)

### Update Base Images

```bash
# Pull latest base images
docker compose -f docker-compose.prod.yml pull

# Rebuild apps with updated bases
docker compose -f docker-compose.prod.yml build --no-cache

# Restart
docker compose -f docker-compose.prod.yml up -d
```

---

## CI/CD Integration

`.github/workflows/deploy.yml` deploys automatically on push to `main` (or manual `workflow_dispatch`). It SSHes into the VPS, backs up Postgres, rebuilds `api`/`web`, brings the stack up with `docker compose -f docker-compose.prod.yml up -d --remove-orphans`, polls `GET /health` and the web root until healthy, then fetches the public site and fails the deploy if it finds dev-mode artifacts (HMR client scripts, `.next/dev`, a `localhost` API URL) in the served HTML — a guard against accidentally shipping a dev build.

It assumes the deploy dir already has a working checkout with `.env` and `docker/seaweedfs/s3.prod.json` in place; it does not provision those itself. The smoke test reads `DOMAIN` from `.env`.

**Required GitHub Secrets** (`Settings → Secrets and variables → Actions`):
- `VPS_HOST` — server IP or hostname
- `VPS_USER` — SSH user
- `VPS_SSH_KEY` — private key for that user
- `VPS_PORT` — SSH port
