#!/bin/sh
# Self-test for scripts/check-prod-env.sh.
#
#   sh scripts/check-prod-env.spec.sh
set -eu

GUARD="$(cd "$(dirname "$0")" && pwd)/check-prod-env.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

printf 'JWT_SECRET=example-secret\nOPENAI_API_KEY=sk-example\n# POSTGRES_PASSWORD=example-password\n# LEMONSQUEEZY_API_KEY=<API key from the LS dashboard>\n# LEMONSQUEEZY_WEBHOOK_SECRET=<signing secret entered when creating the webhook>\n' > "$WORK/example"
GOOD='DOMAIN=optra.tyvera.app
S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com
POSTGRES_PASSWORD=real-password
OPENAI_API_KEY=sk-real
JWT_SECRET=real-secret
OPENAI_PROCUREMENT_EXTRACTION_MODEL=gpt-4o
LEMONSQUEEZY_API_KEY=lsk-real-api-key
LEMONSQUEEZY_STORE_ID=394926
LEMONSQUEEZY_WEBHOOK_SECRET=real-signing-secret
LEMONSQUEEZY_VARIANT_SOLO=1111111
LEMONSQUEEZY_VARIANT_TEAM=2222222
BILLING_ENFORCEMENT=off'

passed=0
failed=0

# case <name> <expected-exit> <env-file-content>
case_() {
    printf '%s\n' "$3" > "$WORK/env"
    set +e
    sh "$GUARD" "$WORK/env" "$WORK/example" > "$WORK/out" 2>&1
    actual=$?
    set -e
    if [ "$actual" -eq "$2" ]; then passed=$((passed + 1)); echo "ok   $1"
    else failed=$((failed + 1)); echo "FAIL $1 (expected $2, got $actual)"; sed 's/^/     /' "$WORK/out"; fi
}

# GOOD with KEY set to VALUE (VALUE must not contain |), or with KEY removed.
with() { printf '%s\n' "$GOOD" | sed "s|^$1=.*|$1=$2|"; }
without() { printf '%s\n' "$GOOD" | sed "/^$1=/d"; }
# repeat <char> <count>
repeat() { awk -v c="$1" -v n="$2" 'BEGIN { for (i = 0; i < n; i++) printf "%s", c }'; }

case_ 'error: a bare DOMAIN is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's/^DOMAIN=.*/DOMAIN=optra/')"
case_ 'error: a DOMAIN with a scheme is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's|^DOMAIN=.*|DOMAIN=https://optra.tyvera.app|')"
case_ 'error: an http S3 endpoint is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's|^S3_ENDPOINT=.*|S3_ENDPOINT=http://seaweedfs:8333|')"
case_ 'error: a placeholder JWT secret is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's/^JWT_SECRET=.*/JWT_SECRET=example-secret/')"
case_ 'error: an empty POSTGRES_PASSWORD is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=/')"
case_ 'error: a placeholder repeated later in the file is refused (compose uses the last one)' 1 "$(printf '%s\nJWT_SECRET=example-secret' "$GOOD")"
case_ 'error: a quoted placeholder is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's/^JWT_SECRET=.*/JWT_SECRET="example-secret"/')"
case_ 'error: a placeholder commented out in .env.example is still refused' 1 "$(printf '%s\n' "$GOOD" | sed 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=example-password/')"
case_ 'error: the test-only THROTTLE_DEFAULT_LIMIT is refused' 1 "$(printf '%s\nTHROTTLE_DEFAULT_LIMIT=100000' "$GOOD")"
case_ 'error: a missing LEMONSQUEEZY_API_KEY is refused' 1 "$(without LEMONSQUEEZY_API_KEY)"
case_ 'error: an empty LEMONSQUEEZY_API_KEY is refused' 1 "$(with LEMONSQUEEZY_API_KEY '')"
case_ 'error: the .env.example placeholder for LEMONSQUEEZY_API_KEY is refused' 1 "$(with LEMONSQUEEZY_API_KEY '<API key from the LS dashboard>')"
case_ 'error: any angle-bracket placeholder is refused even when .env.example does not list it' 1 "$(with LEMONSQUEEZY_API_KEY '<paste the key here>')"
case_ 'error: a missing LEMONSQUEEZY_WEBHOOK_SECRET is refused' 1 "$(without LEMONSQUEEZY_WEBHOOK_SECRET)"
case_ 'error: the .env.example placeholder for LEMONSQUEEZY_WEBHOOK_SECRET is refused' 1 "$(with LEMONSQUEEZY_WEBHOOK_SECRET '<signing secret entered when creating the webhook>')"
case_ 'error: a 5-character LEMONSQUEEZY_WEBHOOK_SECRET is refused' 1 "$(with LEMONSQUEEZY_WEBHOOK_SECRET "$(repeat x 5)")"
case_ 'error: a 41-character LEMONSQUEEZY_WEBHOOK_SECRET is refused' 1 "$(with LEMONSQUEEZY_WEBHOOK_SECRET "$(repeat x 41)")"
case_ 'error: a missing LEMONSQUEEZY_STORE_ID is refused' 1 "$(without LEMONSQUEEZY_STORE_ID)"
case_ 'error: a non-numeric LEMONSQUEEZY_STORE_ID is refused' 1 "$(with LEMONSQUEEZY_STORE_ID 'store-394926')"
case_ 'error: a non-numeric LEMONSQUEEZY_VARIANT_SOLO is refused' 1 "$(with LEMONSQUEEZY_VARIANT_SOLO 'solo')"
case_ 'error: a missing LEMONSQUEEZY_VARIANT_TEAM is refused' 1 "$(without LEMONSQUEEZY_VARIANT_TEAM)"
case_ 'error: the same variant id for Solo and Team is refused' 1 "$(with LEMONSQUEEZY_VARIANT_TEAM 1111111)"
case_ 'error: a missing BILLING_ENFORCEMENT is refused' 1 "$(without BILLING_ENFORCEMENT)"
case_ 'error: BILLING_ENFORCEMENT=true is refused (only the exact value on enforces)' 1 "$(with BILLING_ENFORCEMENT true)"
case_ 'error: BILLING_ENFORCEMENT=ON is refused (case matters to the api)' 1 "$(with BILLING_ENFORCEMENT ON)"
case_ 'error: an empty OPENAI_PROCUREMENT_EXTRACTION_MODEL is refused' 1 "$(with OPENAI_PROCUREMENT_EXTRACTION_MODEL '')"
case_ 'edge: a quoted real value passes' 0 "$(printf '%s\n' "$GOOD" | sed 's/^JWT_SECRET=.*/JWT_SECRET="real-secret"/')"
case_ 'edge: a 6-character LEMONSQUEEZY_WEBHOOK_SECRET passes' 0 "$(with LEMONSQUEEZY_WEBHOOK_SECRET "$(repeat x 6)")"
case_ 'edge: a 40-character LEMONSQUEEZY_WEBHOOK_SECRET passes' 0 "$(with LEMONSQUEEZY_WEBHOOK_SECRET "$(repeat x 40)")"
case_ 'edge: BILLING_ENFORCEMENT=on passes' 0 "$(with BILLING_ENFORCEMENT on)"
case_ 'edge: quoted billing values pass' 0 "$(with LEMONSQUEEZY_STORE_ID '"394926"' | sed 's/^BILLING_ENFORCEMENT=.*/BILLING_ENFORCEMENT="off"/')"
case_ 'happy: a complete production .env passes' 0 "$GOOD"

echo ""
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
