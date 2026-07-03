#!/bin/bash
set -e

# Deploy from local machine to Hetzner VPS
# Usage: ./scripts/deploy-remote.sh user@your-server-ip

if [ -z "$1" ]; then
    echo "Usage: $0 user@server-ip"
    exit 1
fi

SERVER=$1
APP_DIR="/opt/mnemra"

echo "🚀 Deploying to $SERVER..."

# Sync code to server
echo "📦 Syncing code..."
rsync -avz --exclude 'node_modules' \
    --exclude '.next' \
    --exclude 'dist' \
    --exclude '.turbo' \
    --exclude '.env*' \
    --exclude '.git' \
    ./ $SERVER:$APP_DIR/

# Copy production env
if [ -f .env ]; then
    echo "📝 Copying production environment..."
    scp .env $SERVER:$APP_DIR/.env
else
    echo "⚠️  .env not found locally - make sure it exists on server"
fi

# Run deployment on server
echo "🔧 Running deployment on server..."
ssh $SERVER << 'ENDSSH'
cd /opt/mnemra
chmod +x scripts/deploy.sh
./scripts/deploy.sh
ENDSSH

echo "✅ Remote deployment complete!"
