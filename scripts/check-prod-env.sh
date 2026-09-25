#!/bin/sh
# Refuse a production .env that cannot work, before anything is built.
#
#   sh scripts/check-prod-env.sh [path-to-.env] [path-to-.env.example]
#
# Reads the file without sourcing it (values may hold shell metacharacters).
# Prints every problem, never a value, and exits 1 if there is any.
set -eu

ENV_FILE="${1:-.env}"
EXAMPLE_FILE="${2:-.env.example}"
problems=0

value_of() {
    grep -m1 "^$1=" "$2" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true
}

fail() {
    echo "  $1"
    problems=$((problems + 1))
}

if [ ! -f "$ENV_FILE" ]; then
    echo "check-prod-env: $ENV_FILE not found" >&2
    exit 1
fi

echo "check-prod-env: $ENV_FILE"

domain="$(value_of DOMAIN "$ENV_FILE")"
if ! printf '%s' "$domain" | grep -Eq '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$'; then
    fail "DOMAIN must be the site's hostname, e.g. optra.tyvera.app (no scheme, at least one dot)"
fi

if ! value_of S3_ENDPOINT "$ENV_FILE" | grep -Eq '^https://'; then
    fail "S3_ENDPOINT must be an https:// endpoint"
fi

for key in POSTGRES_PASSWORD OPENAI_API_KEY JWT_SECRET; do
    actual="$(value_of "$key" "$ENV_FILE")"
    example="$(value_of "$key" "$EXAMPLE_FILE")"
    if [ -z "$actual" ]; then
        fail "$key is empty"
    elif [ -n "$example" ] && [ "$actual" = "$example" ]; then
        fail "$key is still the .env.example placeholder"
    fi
done

trust="$(value_of TRUST_PROXY "$ENV_FILE")"
if [ -n "$trust" ] && ! printf '%s' "$trust" | grep -Eq '^[1-9][0-9]*$'; then
    fail "TRUST_PROXY, if set, must be a positive hop count"
fi

if [ "$problems" -gt 0 ]; then
    echo "check-prod-env: $problems problem(s) - nothing was built or restarted"
    exit 1
fi
echo "check-prod-env: ok"
