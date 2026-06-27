# Deployment Guide

## Local Development

### Prerequisites
- Bun installed
- Docker & Docker Compose installed

### Quick Start

```bash
# Start infrastructure + dev servers
./scripts/dev.sh

# Or manually:
docker compose up -d           # Start Postgres + Redis
cp .env.example .env.local     # Configure environment
bun install                     # Install dependencies
cd packages/db && bun run db:push && cd ../..  # Run migrations
bun run dev                     # Start all apps
```

**Apps running:**
- 🌐 Web: http://localhost:3000
- 🔌 API: http://localhost:3001
- 🐘 Postgres: localhost:54321 (mapped to avoid conflicts)
- 🔴 Redis: localhost:6379

**Hot reload:** Edit any file in `apps/` or `packages/` → changes reflect immediately (no Docker rebuild)

### Stop Development

```bash
# Stop apps (Ctrl+C in terminal)
# Stop infrastructure
docker compose down
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
mkdir -p /opt/support-brain
chown -R $USER:$USER /opt/support-brain

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
# Copy production template
cp .env.production .env.prod

# Edit with your values
nano .env.prod
```

Required values:
```bash
DOMAIN=your-domain.com                    # Your Squarespace domain
POSTGRES_PASSWORD=STRONG_RANDOM_PASSWORD  # Generate strong password
OPENAI_API_KEY=sk-your-production-key     # Production OpenAI key
LANGSMITH_API_KEY=ls__your-key            # Optional
```

### 4. Deploy

**Option A: Deploy from local machine**

```bash
# Deploy code + run production build
./scripts/deploy-remote.sh deploy@YOUR_SERVER_IP
```

This will:
- Sync code to server
- Copy `.env.prod`
- Build Docker images
- Run migrations
- Start all services
- Configure SSL automatically (Caddy)

**Option B: Deploy on server directly**

```bash
# On server
cd /opt/support-brain

# Clone repo or upload code
git clone YOUR_REPO .

# Copy environment
cp .env.production .env.prod
nano .env.prod  # Fill in values

# Deploy
./scripts/deploy.sh
```

### 5. Verify Deployment

**Check services:**
```bash
# On server
docker compose -f docker-compose.prod.yml ps
```

Should show:
- ✅ postgres (healthy)
- ✅ redis (healthy)
- ✅ api (running)
- ✅ web (running)
- ✅ caddy (running)

**Check logs:**
```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f web
docker compose -f docker-compose.prod.yml logs -f api
```

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
cd /opt/support-brain
git pull  # or re-sync code
./scripts/deploy.sh
```

### Database Migrations

```bash
# On server
docker compose -f docker-compose.prod.yml run --rm api \
  sh -c "cd packages/db && bun run db:generate && bun run db:push"
```

### Backup Database

```bash
# On server
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U postgres support_brain > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Restore Database

```bash
# On server
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres support_brain < backup.sql
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
  psql -U postgres -d support_brain -c "SELECT 1"
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

- [ ] Strong `POSTGRES_PASSWORD` in `.env.prod`
- [ ] `.env.prod` is in `.gitignore` (never committed)
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
┌─────────────┐
│ Your Machine│
├─────────────┤
│ apps/web    │ :3000  (hot reload)
│ apps/api    │ :3001  (hot reload)
└─────────────┘
       │
       ▼
┌─────────────┐
│   Docker    │
├─────────────┤
│ PostgreSQL  │ :5432
│ Redis       │ :6379
└─────────────┘
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
   ├──▶ apps/web      :3000
   └──▶ apps/api      :3001
          │
          ▼
   ┌──────────────┐
   │ PostgreSQL   │
   │ Redis        │
   └──────────────┘
```

All in Docker network, SSL auto-managed by Caddy.
