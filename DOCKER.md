# Docker Guide

## Local Development (Hot Reload)

### Architecture
Apps run on **host** with `bun run dev` → **instant hot reload**  
Infrastructure runs in **Docker** → Postgres + Redis

**No Docker rebuilds needed when you change code!**

### Start Everything

```bash
# Automated
bun run docker:dev
# or
./scripts/dev.sh

# This will:
# 1. Start Docker (Postgres + Redis)
# 2. Wait for services to be healthy
# 3. Run database migrations
# 4. Start all dev servers (web + api)
```

**Services:**
- 🌐 **Web**: http://localhost:3000 (Next.js with hot reload)
- 🔌 **API**: http://localhost:3001 (NestJS with hot reload)
- 🐘 **Postgres**: localhost:5432
- 🔴 **Redis**: localhost:6379

### Stop Everything

```bash
# Stop dev servers: Ctrl+C in terminal

# Stop Docker infrastructure
bun run docker:stop
# or
docker compose down
```

### View Logs

```bash
# Docker logs
bun run docker:logs

# Or specific service
docker compose logs -f postgres
docker compose logs -f redis
```

### Reset Database

```bash
# Stop everything
docker compose down

# Remove data volumes
docker compose down -v

# Start fresh
bun run docker:dev
```

---

## Production (Hetzner VPS)

### Full Containerization
Everything runs in Docker:
- Next.js app (web)
- NestJS API (api)
- PostgreSQL with pgvector
- Redis
- Caddy (reverse proxy + auto SSL)

### Deploy

**From local machine:**
```bash
# First time setup
cp .env.production .env.prod
nano .env.prod  # Fill in DOMAIN, passwords, API keys

# Deploy
bun run deploy:remote user@your-server-ip
```

**On server directly:**
```bash
cd /opt/support-brain
./scripts/deploy.sh
```

### What Happens

1. **Build multi-stage Docker images** (optimized, small)
   - Install deps → Build packages → Build apps → Copy to minimal runtime
2. **Stop old containers** (zero-downtime with health checks)
3. **Run database migrations**
4. **Start all services**
5. **Caddy obtains SSL certificate** (automatic, from Let's Encrypt)

### Services

```bash
# Check status
docker compose -f docker-compose.prod.yml ps

# Should show:
# - postgres (healthy)
# - redis (healthy)
# - api (running)
# - web (running)
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
```

### Rollback

```bash
# On server
cd /opt/support-brain

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

Multi-stage build:
1. **deps**: Install all dependencies
2. **builder**: Build shared packages + Next.js app
3. **runner**: Minimal runtime with only production files

**Size**: ~200MB (optimized standalone build)

### API (NestJS)

Multi-stage build:
1. **deps**: Install dependencies
2. **builder**: Build shared packages + NestJS
3. **runner**: Minimal runtime with compiled JS

**Size**: ~150MB

### Build Images Manually

```bash
# Web
docker build -f apps/web/Dockerfile -t support-brain-web .

# API
docker build -f apps/api/Dockerfile -t support-brain-api .
```

---

## Networks

### Local Development
```
Host machine (:3000, :3001)
    ↓ localhost
Docker (postgres:5432, redis:6379)
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
          └─ redis (:6379) ← internal only
```

**Networks:**
- `web`: Caddy ↔ apps (public-facing)
- `internal`: apps ↔ database/redis (private)

Database & Redis **not exposed** to internet.

---

## Volumes

### Local Development

```bash
# List volumes
docker volume ls

# Inspect
docker volume inspect second-brain_postgres_data
docker volume inspect second-brain_redis_data

# Backup
docker run --rm -v second-brain_postgres_data:/data \
  -v $(pwd):/backup alpine tar czf /backup/postgres-backup.tar.gz /data
```

### Production

```bash
# List
docker volume ls | grep support-brain

# Backup Postgres
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U postgres support_brain | gzip > backup-$(date +%Y%m%d).sql.gz

# Restore
gunzip < backup.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres support_brain
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
docker compose exec postgres psql -U postgres -d support_brain -c "SELECT 1"

# Check env vars
docker compose exec api env | grep DATABASE_URL
```

---

## Performance

### Local Development

**Hot reload speed:**
- Next.js: ~100-500ms (Fast Refresh)
- NestJS: ~1-2s (incremental TypeScript compilation)

**No Docker rebuilds** = instant feedback loop

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
- [x] Secrets in .env.prod (not in images)
- [ ] Regular image updates (`docker compose pull`)
- [ ] Database backups automated
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

### GitHub Actions Example

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to Hetzner
        env:
          SSH_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
        run: |
          echo "$SSH_KEY" > key.pem
          chmod 600 key.pem
          ssh -i key.pem -o StrictHostKeyChecking=no \
            deploy@${{ secrets.SERVER_IP }} \
            "cd /opt/support-brain && git pull && ./scripts/deploy.sh"
```

Add secrets in GitHub repo settings:
- `SSH_PRIVATE_KEY`
- `SERVER_IP`
