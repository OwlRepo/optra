#!/bin/bash
set -eu

# Production deployment script for Hetzner VPS

echo "🚀 Deploying to production..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env not found"
    echo "📝 Copy .env.example to .env and fill in values"
    exit 1
fi

read_env() {
    awk -F= -v key="$1" '$1 == key { sub(/\r$/, "", $0); print substr($0, length(key) + 2); exit }' .env
}

DOMAIN="$(read_env DOMAIN)"
POSTGRES_PASSWORD="$(read_env POSTGRES_PASSWORD)"
OPENAI_API_KEY="$(read_env OPENAI_API_KEY)"
COMPOSE_PROFILES_VALUE="$(read_env COMPOSE_PROFILES | tr -d '[:space:]')"
export COMPOSE_PROFILES="$COMPOSE_PROFILES_VALUE"

# Validate required vars
if [ -z "$DOMAIN" ]; then
    echo "❌ DOMAIN not set in .env"
    exit 1
fi

if [ -z "$POSTGRES_PASSWORD" ]; then
    echo "❌ POSTGRES_PASSWORD not set in .env"
    exit 1
fi

if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ OPENAI_API_KEY not set in .env"
    exit 1
fi

sh scripts/ensure-seaweedfs-s3-config.sh

public_ingress_enabled=0
case ",$COMPOSE_PROFILES_VALUE," in
    *",public,"*)
        public_ingress_enabled=1
        ;;
esac

echo "📦 Building production images..."
docker compose -f docker-compose.prod.yml build api web

echo "🚀 Starting production services..."
if [ "$public_ingress_enabled" -ne 1 ]; then
    echo "ℹ️  Bundled Caddy profile disabled; removing old Caddy container if present"
    docker rm -f mnemra-prod-caddy >/dev/null 2>&1 || true
fi
docker compose -f docker-compose.prod.yml up -d --remove-orphans --force-recreate

echo "🔍 Checking production API health..."
api_ok=0
for i in $(seq 1 15); do
    docker compose -f docker-compose.prod.yml exec -T api \
        wget -q -O /dev/null http://127.0.0.1:3001/health && { api_ok=1; break; }
    echo "api health check retry $i..."
    sleep 4
done
if [ "$api_ok" -ne 1 ]; then
    echo "❌ api health check failed"
    docker compose -f docker-compose.prod.yml logs --tail=120 api web postgres seaweedfs
    exit 1
fi

echo "🔍 Checking production web health..."
web_ok=0
for i in $(seq 1 10); do
    docker compose -f docker-compose.prod.yml exec -T web \
        wget -q -O /dev/null http://127.0.0.1:3000/ && { web_ok=1; break; }
    echo "web health check retry $i..."
    sleep 3
done
if [ "$web_ok" -ne 1 ]; then
    echo "❌ web health check failed"
    if [ "$public_ingress_enabled" -eq 1 ]; then
        docker compose -f docker-compose.prod.yml logs --tail=120 api web postgres seaweedfs caddy
    else
        docker compose -f docker-compose.prod.yml logs --tail=120 api web postgres seaweedfs
    fi
    exit 1
fi

echo "🔍 Checking production S3 round trip..."
docker compose -f docker-compose.prod.yml exec -T api env NODE_NO_WARNINGS=1 node <<'NODE'
const {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3')

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
})

const bucket = process.env.S3_BUCKET
const key = `deploy-healthcheck/${Date.now()}-${process.pid}.txt`

async function ensureBucket() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
    return
  } catch (error) {
    const code = error?.name || error?.Code || error?.$metadata?.httpStatusCode
    if (!['NotFound', 'NoSuchBucket', '404', 404].includes(code)) throw error
  }

  await client.send(new CreateBucketCommand({ Bucket: bucket }))
}

async function main() {
  await ensureBucket()
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: Buffer.from('ok'),
    ContentType: 'text/plain',
  }))

  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const chunks = []
  for await (const chunk of result.Body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const body = Buffer.concat(chunks).toString('utf8')
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))

  if (body !== 'ok') {
    throw new Error(`unexpected S3 round-trip body: ${body}`)
  }

  console.log('s3 round trip ok')
}

main().catch((error) => {
  console.error(error?.name || error?.Code || 'S3Error')
  console.error(error?.message || String(error))
  process.exit(1)
})
NODE

if [ "$public_ingress_enabled" -eq 1 ]; then
    echo "🔍 Checking public HTTPS route..."
    html="$(mktemp)"
    curl -fsS --max-time 15 "https://${DOMAIN}/" -o "$html" || { echo "❌ public smoke fetch failed"; exit 1; }
    if grep -Eq 'hmr-client|next-devtools|\.next/dev|localhost:[0-9]+|127\.0\.0\.1' "$html"; then
        echo "❌ public smoke check found dev artifacts"
        exit 1
    fi
else
    echo "ℹ️  Skipping public HTTPS smoke; set COMPOSE_PROFILES=public only when Mnemra owns 80/443"
fi

echo "✅ Deployment complete!"
echo ""
if [ "$public_ingress_enabled" -eq 1 ]; then
    echo "🌐 Your app is now running at: https://${DOMAIN}"
else
    echo "🌐 Internal app stack is healthy; configure your existing host ingress to route to the web container."
fi
echo ""
echo "📊 Check logs:"
echo "  docker compose -f docker-compose.prod.yml logs -f"
echo ""
echo "🔍 Check status:"
echo "  docker compose -f docker-compose.prod.yml ps"
