#!/bin/sh
# Self-test for scripts/check-test-layers.sh: builds a throwaway repository,
# makes one commit per scenario, and asserts the guard's verdict.
#
#   sh scripts/check-test-layers.spec.sh
set -eu

GUARD="$(cd "$(dirname "$0")" && pwd)/check-test-layers.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

git init -q
git config user.email guard@test.local
git config user.name guard
git commit -q --allow-empty -m baseline
BASE="$(git rev-parse HEAD)"

passed=0
failed=0

# scenario <name> <expected-exit> <commit-message> <file>...
scenario() {
    name="$1"; expected="$2"; message="$3"; shift 3
    git checkout -q -B "case" "$BASE"
    for file in "$@"; do
        mkdir -p "$(dirname "$file")"
        echo "// $name" >> "$file"
    done
    git add -A
    git commit -q -m "$message"
    set +e
    output="$(sh "$GUARD" "$BASE" HEAD 2>&1)"
    actual=$?
    set -e
    if [ "$actual" -eq "$expected" ]; then
        passed=$((passed + 1))
        echo "ok   $name"
    else
        failed=$((failed + 1))
        echo "FAIL $name (expected exit $expected, got $actual)"
        printf '%s\n' "$output" | sed 's/^/     /'
    fi
}

scenario 'docs only needs nothing' 0 'docs: words' docs/readme.md
scenario 'service without its spec fails' 1 'feat: x' apps/api/src/storage/storage.service.ts
scenario 'service with a spec in its directory passes' 0 'feat: x' \
    apps/api/src/storage/storage.service.ts apps/api/src/storage/storage.service.spec.ts
scenario 'a spec in another directory does not count' 1 'feat: x' \
    apps/api/src/storage/storage.service.ts apps/api/src/catalog/catalog.service.spec.ts
scenario 'processor without its spec fails' 1 'fix: x' apps/api/src/ingest/ingest.processor.ts
scenario 'controller with unit spec but no API e2e fails' 1 'feat: x' \
    apps/api/src/documents/documents.controller.ts apps/api/src/documents/documents.controller.spec.ts
scenario 'controller with unit spec and API e2e passes' 0 'feat: x' \
    apps/api/src/documents/documents.controller.ts apps/api/src/documents/documents.controller.spec.ts \
    apps/api/test/documents.e2e-spec.ts
scenario 'web page without a browser test fails' 1 'feat: x' \
    'apps/web/app/workspaces/[id]/procurement/page.tsx'
scenario 'web page with a browser test passes' 0 'feat: x' \
    'apps/web/app/workspaces/[id]/procurement/page.tsx' apps/e2e/tests/procurement.spec.ts
scenario 'BFF route without a browser test fails' 1 'fix: x' \
    'apps/web/app/api/workspaces/[id]/datasets/route.ts'
scenario 'a stated skip passes and is reported' 0 'chore: rename a local

Test-Layers-Skip: rename only, no behaviour moved' apps/api/src/storage/storage.service.ts
scenario 'a skip line in the body, not a trailer, does not count' 1 'chore: x

Test-Layers-Skip: not a trailer

more words after it' apps/api/src/storage/storage.service.ts
scenario 'a shared API helper without its spec fails' 1 'refactor: x' apps/api/src/common/throttle.ts
scenario 'a guard without its spec fails' 1 'fix: x' apps/api/src/auth/guards/roles.guard.ts
scenario 'web middleware without its spec fails' 1 'fix: x' apps/web/middleware.ts
scenario 'a BFF helper with its spec passes' 0 'fix: x' \
    apps/web/src/lib/http/client-ip.ts apps/web/src/lib/http/client-ip.spec.ts
scenario 'a DTO is not policed' 0 'feat: x' apps/api/src/auth/dto/login.dto.ts
scenario 'a DTO under common/ is not policed either' 0 'feat: x' apps/api/src/common/dto/pagination.dto.ts

echo ""
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
