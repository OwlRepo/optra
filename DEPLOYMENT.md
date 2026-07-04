# Deployment Guide

## Local Development

### Prerequisites

- Docker & Docker Compose installed
- Bun installed (only needed if you want to run commands outside Docker, e.g. `bun run type-check`)

### Quick Start

```bash
cp .env.example .env    # Configure environment
bun run docker:dev:up   # Start the full stack, build images on first run
```

Everything — Postgres, Redis, SeaweedFS, the API, and the web app — runs in Docker. Migrations run automatically from the API container on start. No separate `bun install`, manual migration, or `bun run dev` steps needed.

**Apps running:**

- 🌐 Web: http://localhost:3100
- 🔌 API: http://localhost:3101
- 🐘 Postgres: localhost:54321 (mapped to avoid conflicts)
- 🔴 Redis: localhost:6379
- 📦 SeaweedFS: localhost:8333 (S3), localhost:8888 (filer), localhost:9333 (master)

**Hot reload:** Edit any file in `apps/` or `packages/` → changes reflect within a few seconds (bind-mounted source, polling-based file watch, no image rebuild needed)

### Stop Development

```bash
bun run docker:dev:down     # Stop the stack, keep volumes
bun run docker:dev:down -v  # Stop and wipe volumes (fresh DB next start)
```

---

## Production Deployment (Hetzner VPS)

### 1. VPS Setup

**Create Hetzner VPS:**

1. Go to https://www.hetzner.com/cloud
2. Create project
3. Deploy Ubuntu 24.04 server (CX21 or higher)
4. Note the IP address

**Initial server setup:**

```bash
# SSH into server
ssh root@YOUR_SERVER_IP

# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install docker-compose-plugin -y

# Create app directory
mkdir -p /opt/mnemra
chown -R $USER:$USER /opt/mnemra

# Create non-root user (optional but recommended)
adduser deploy
usermod -aG docker deploy
```

### 2. Domain Setup (Squarespace)

**Configure DNS:**

1. Log into Squarespace
2. Go to Settings → Domains → your-domain.com → DNS Settings
3. Add **A Record**:
   - Host: `@`
   - Value: `YOUR_HETZNER_IP`
   - TTL: 3600
4. Add **CNAME Record** (optional, for www):
   - Host: `www`
   - Value: `your-domain.com`
   - TTL: 3600

**Wait for DNS propagation** (5-60 minutes)

```bash
# Check DNS
dig your-domain.com +short
# Should return your Hetzner IP
```

### 3. Configure Production Environment

On your **local machine**:

```bash
# Copy the committed template
cp .env.example .env

# Edit with your values
nano .env
```

Required values:

```bash
DOMAIN=your-domain.com                    # Your Squarespace domain
POSTGRES_PASSWORD=STRONG_RANDOM_PASSWORD  # Generate strong password
OPENAI_API_KEY=sk-your-production-key     # Production OpenAI key
LANGSMITH_API_KEY=ls__your-key            # Optional
```

Also provision the SeaweedFS prod credentials file (not covered by `.env`):

```bash
cp docker/seaweedfs/s3.prod.json.example docker/seaweedfs/s3.prod.json
nano docker/seaweedfs/s3.prod.json  # Fill in real accessKey/secretKey, matching whatever you use for S3_ACCESS_KEY/S3_SECRET_KEY
```

### 4. Deploy

**Option A: Deploy from local machine**

```bash
# Deploy code + run production build
./scripts/deploy-remote.sh deploy@YOUR_SERVER_IP
```

This will:

- Sync code to server
- Copy `.env`
- Build Docker images
- Start all services; the API container runs `db:migrate` during startup
- Configure SSL automatically (Caddy)

**Option B: Deploy on server directly**

```bash
# On server
cd /opt/mnemra

# Clone repo or upload code
git clone YOUR_REPO .

# Copy environment
cp .env.example .env
nano .env  # Fill in values
cp docker/seaweedfs/s3.prod.json.example docker/seaweedfs/s3.prod.json
nano docker/seaweedfs/s3.prod.json  # Fill in values

# Deploy
./scripts/deploy.sh
```

**Option C: Automatic deploy via GitHub Actions**

`.github/workflows/deploy.yml` deploys automatically on every push to `main` (or via manual `workflow_dispatch`). It SSHes into the VPS, pulls latest, backs up Postgres, rebuilds `api`/`web`, brings the stack up, and runs a healthcheck + smoke-test before declaring success.

This assumes the deploy directory already has a working checkout with `.env` and `docker/seaweedfs/s3.prod.json` in place (i.e. you've already done Option A or B once) — the workflow does not provision secrets on the VPS itself. The post-deploy smoke test reads `DOMAIN` directly from that `.env`, so no separate domain secret is needed.

Configure these **GitHub Secrets** on the repo (`Settings → Secrets and variables → Actions`):
| Secret | Value |
|---|---|
| `VPS_HOST` | Server IP or hostname |
| `VPS_USER` | SSH user (e.g. `deploy`) |
| `VPS_SSH_KEY` | Private key with access to that user |
| `VPS_PORT` | SSH port (usually `22`) |

### 5. Verify Deployment

**Check services:**

```bash
# On server
docker compose -f docker-compose.prod.yml ps
```

Should show:

- ✅ postgres (healthy)
- ✅ redis (healthy)
- ✅ seaweedfs (healthy)
- ✅ api (healthy)
- ✅ web (healthy)
- ✅ caddy (running)

**Check logs:**

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f web
docker compose -f docker-compose.prod.yml logs -f api
```

**Test internal health endpoints:**

```bash
docker compose -f docker-compose.prod.yml exec -T api \
  wget -q -O - http://127.0.0.1:3001/health

docker compose -f docker-compose.prod.yml exec -T web \
  wget -q -O /dev/null http://127.0.0.1:3000/
```

Production does not publish the `api` or `web` ports on the host. Caddy is the only public ingress.

**Test SSL:**

```bash
curl -I https://your-domain.com
# Should return 200 OK with HTTPS
```

**Visit your app:**

- 🌐 https://your-domain.com

### 6. SSL Certificate

Caddy automatically obtains and renews Let's Encrypt SSL certificates.

**First request takes ~30 seconds** while Caddy:

1. Validates domain ownership
2. Requests certificate from Let's Encrypt
3. Configures HTTPS

**Check SSL:**

```bash
# View Caddy logs
docker compose -f docker-compose.prod.yml logs caddy | grep -i certificate
```

---

## Management

### Update Production

```bash
# From local machine
./scripts/deploy-remote.sh deploy@YOUR_SERVER_IP

# Or on server
cd /opt/mnemra
git pull  # or re-sync code
./scripts/deploy.sh

# Or just push to main and let GitHub Actions do it (Option C above)
```

### Database Migrations

The API container runs migrations automatically on startup. To run them manually on the server:

```bash
# On server
docker compose -f docker-compose.prod.yml run --rm api \
  sh -c "cd packages/db && bun run db:migrate"
```

### Backup Database

```bash
# On server
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > backup_$(date +%Y%m%d_%H%M%S).sql
```

The GitHub Actions deploy workflow also takes an automatic backup before every deploy, stored in `/home/deploy/apps/mnemra-backups/`, retained 14 days.

### Restore Database

```bash
# On server
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backup.sql
```

### View Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Web app only
docker compose -f docker-compose.prod.yml logs -f web

# API only
docker compose -f docker-compose.prod.yml logs -f api

# Last 100 lines
docker compose -f docker-compose.prod.yml logs --tail=100
```

### Restart Services

```bash
# Restart all
docker compose -f docker-compose.prod.yml restart

# Restart specific service
docker compose -f docker-compose.prod.yml restart web
docker compose -f docker-compose.prod.yml restart api
```

### Stop Production

```bash
docker compose -f docker-compose.prod.yml down
# Keep data: volumes are persistent

# Remove everything including volumes
docker compose -f docker-compose.prod.yml down -v
```

---

## Troubleshooting

### Port conflicts

```bash
# Check what's using ports
sudo lsof -i :80
sudo lsof -i :443
sudo lsof -i :5432

# Stop conflicting services
sudo systemctl stop nginx  # if nginx is running
```

### SSL not working

```bash
# Check Caddy logs
docker compose -f docker-compose.prod.yml logs caddy

# Verify DNS
dig your-domain.com +short

# Test certificate
curl -vI https://your-domain.com
```

### Database connection errors

```bash
# Check Postgres logs
docker compose -f docker-compose.prod.yml logs postgres

# Test connection
docker compose -f docker-compose.prod.yml exec postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT 1"'
```

### `api`/`web` never becomes healthy

```bash
# api and web now have real HEALTHCHECKs (GET /health, GET /) — a container stuck
# "starting" or "unhealthy" usually means the app crashed on boot. Check:
docker compose -f docker-compose.prod.yml logs api
docker compose -f docker-compose.prod.yml logs web

# Common causes: missing/invalid OPENAI_API_KEY, POSTGRES_PASSWORD, or DOMAIN in
# .env, or docker/seaweedfs/s3.prod.json was never created from the .example.
```

### Out of memory

```bash
# Check usage
docker stats

# Increase VPS resources in Hetzner console
# Or reduce container memory limits in docker-compose.prod.yml
```

---

## Security Checklist

- [ ] Strong `POSTGRES_PASSWORD` in `.env`
- [ ] `.env` is in `.gitignore` (never committed)
- [ ] `docker/seaweedfs/s3.prod.json` is in `.gitignore` (never committed)
- [ ] Firewall configured (only ports 80, 443, 22 open)
- [ ] SSH key authentication enabled (disable password auth)
- [ ] Regular database backups scheduled
- [ ] API keys rotated periodically
- [ ] Docker images updated regularly

### Configure Firewall (UFW)

```bash
# On server
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw enable
ufw status
```

---

## Architecture

### Local Development

```
┌──────────────────────────┐
│         Docker            │
├──────────────────────────┤
│ apps/web    :3000  (3100 on host; hot reload, bind-mounted) │
│ apps/api    :3001  (3101 on host; hot reload, bind-mounted) │
│ PostgreSQL  :5432  (54321 on host)            │
│ Redis       :6379                             │
│ SeaweedFS   :8333/:8888/:9333                 │
└──────────────────────────┘
```

### Production

```
Internet
   │
   ▼
┌────────────────────┐
│  Caddy (SSL)       │  :80, :443
└────────────────────┘
   │
   └──▶ apps/web      :3000  (healthchecked; serves UI + /api/* proxy routes)
          │
          └──▶ apps/api      :3001  (healthchecked; internal only)
          │
          ▼
   ┌──────────────┐
   │ PostgreSQL   │
   │ Redis        │
   │ SeaweedFS    │
   └──────────────┘
```

All in Docker network, SSL auto-managed by Caddy. `web`/`caddy` wait on real healthchecks before starting/routing traffic.
