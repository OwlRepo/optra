#!/bin/sh
set -eu

ENV_FILE="${1:-.env}"
OUTPUT_FILE="${2:-docker/seaweedfs/s3.prod.json}"

read_env() {
    awk -F= -v key="$1" '$1 == key { sub(/\r$/, "", $0); print substr($0, length(key) + 2); exit }' "$ENV_FILE"
}

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

is_placeholder() {
    case "$1" in
        ""|*"REPLACE_WITH"*|*"your-key-here"*|"mnemra-local"|"mnemra-local-secret")
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

if [ ! -f "$ENV_FILE" ]; then
    echo "❌ $ENV_FILE not found"
    exit 1
fi

if [ -f "$OUTPUT_FILE" ] && ! grep -Eq 'REPLACE_WITH|your-key-here|mnemra-local' "$OUTPUT_FILE"; then
    exit 0
fi

S3_ACCESS_KEY="$(read_env S3_ACCESS_KEY)"
S3_SECRET_KEY="$(read_env S3_SECRET_KEY)"

if is_placeholder "$S3_ACCESS_KEY" || is_placeholder "$S3_SECRET_KEY"; then
    echo "❌ S3_ACCESS_KEY/S3_SECRET_KEY missing or still placeholder in $ENV_FILE"
    echo "📝 Set production S3 credentials in $ENV_FILE, then rerun deploy"
    exit 1
fi

mkdir -p "$(dirname "$OUTPUT_FILE")"
ACCESS_KEY_JSON="$(json_escape "$S3_ACCESS_KEY")"
SECRET_KEY_JSON="$(json_escape "$S3_SECRET_KEY")"

cat > "$OUTPUT_FILE" <<EOF
{
  "identities": [
    {
      "name": "mnemra",
      "credentials": [
        {
          "accessKey": "$ACCESS_KEY_JSON",
          "secretKey": "$SECRET_KEY_JSON"
        }
      ],
      "actions": ["Admin", "Read", "Write"]
    }
  ]
}
EOF

chmod 600 "$OUTPUT_FILE"
echo "created $OUTPUT_FILE from $ENV_FILE"
