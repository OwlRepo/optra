#!/bin/sh
# Self-test for scripts/check-prod-env.sh.
#
#   sh scripts/check-prod-env.spec.sh
set -eu

GUARD="$(cd "$(dirname "$0")" && pwd)/check-prod-env.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

printf 'JWT_SECRET=example-secret\nOPENAI_API_KEY=sk-example\n# POSTGRES_PASSWORD=example-password\n' > "$WORK/example"
GOOD='DOMAIN=optra.tyvera.app
S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com
POSTGRES_PASSWORD=real-password
OPENAI_API_KEY=sk-real
JWT_SECRET=real-secret'

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

case_ 'error: a bare DOMAIN is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's/^DOMAIN=.*/DOMAIN=optra/')"
case_ 'error: a DOMAIN with a scheme is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's|^DOMAIN=.*|DOMAIN=https://optra.tyvera.app|')"
case_ 'error: an http S3 endpoint is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's|^S3_ENDPOINT=.*|S3_ENDPOINT=http://seaweedfs:8333|')"
case_ 'error: a placeholder JWT secret is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's/^JWT_SECRET=.*/JWT_SECRET=example-secret/')"
case_ 'error: an empty POSTGRES_PASSWORD is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=/')"
case_ 'error: a placeholder repeated later in the file is refused (compose uses the last one)' 1 "$(printf '%s\nJWT_SECRET=example-secret' "$GOOD")"
case_ 'error: a quoted placeholder is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's/^JWT_SECRET=.*/JWT_SECRET="example-secret"/')"
case_ 'error: a placeholder commented out in .env.example is still refused' 1 "$(printf '%s\n' "$GOOD" | sed 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=example-password/')"
case_ 'error: the test-only THROTTLE_DEFAULT_LIMIT is refused' 1 "$(printf '%s\nTHROTTLE_DEFAULT_LIMIT=100000' "$GOOD")"
case_ 'edge: a quoted real value passes' 0 "$(printf '%s\n' "$GOOD" | sed 's/^JWT_SECRET=.*/JWT_SECRET="real-secret"/')"
case_ 'happy: a complete production .env passes' 0 "$GOOD"

echo ""
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
