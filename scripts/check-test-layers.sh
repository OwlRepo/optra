#!/bin/sh
# Require the tests for every layer a commit touches.
#
#   sh scripts/check-test-layers.sh <base-sha> [head]
#
# Checked per commit, not per push, so code and the tests that prove it land
# together - the same order TDD produces them in. For every non-merge commit
# in base..head:
#
#   apps/api/src/**/*.{service,controller,processor}.ts
#       needs a *.spec.ts changed in the same directory     (unit)
#   apps/api/src/**/*.controller.ts
#       also needs apps/api/test/*.e2e-spec.ts changed      (API e2e)
#   apps/web/app/**/page.tsx, apps/web/app/api/**/route.ts
#       needs apps/e2e/tests/*.spec.ts changed              (browser e2e)
#
# A commit that genuinely needs no new test says so, with a reason, as a
# trailer in its message - and the reason is printed in the run log:
#
#   Test-Layers-Skip: comment-only change, no behaviour moved
#
# Deleted files are ignored; there is nothing left to test.
set -eu

BASE="${1:-}"
HEAD="${2:-HEAD}"
ZERO=0000000000000000000000000000000000000000

if [ -z "$BASE" ] || [ "$BASE" = "$ZERO" ] || ! git cat-file -e "$BASE^{commit}" 2>/dev/null; then
    # A new branch's first push has no `before`; compare with main instead.
    BASE="$(git merge-base "$HEAD" origin/main 2>/dev/null || true)"
fi
if [ -z "$BASE" ]; then
    echo "check-test-layers: no base commit to compare against - nothing checked" >&2
    exit 0
fi

failures=0
problems="$(mktemp)"
trap 'rm -f "$problems"' EXIT

for commit in $(git rev-list --no-merges --reverse "$BASE..$HEAD"); do
    files="$(git diff-tree --no-commit-id --name-only -r --diff-filter=ACMR "$commit")"
    : > "$problems"

    touched() {
        printf '%s\n' "$files" | grep -q -E "$1"
    }

    printf '%s\n' "$files" | while IFS= read -r file; do
        case "$file" in
            apps/api/src/*.spec.ts) ;;
            apps/api/src/*.service.ts | apps/api/src/*.controller.ts | apps/api/src/*.processor.ts)
                dir="${file%/*}"
                touched "^${dir}/[^/]+\\.spec\\.ts\$" ||
                    echo "  unit:     $file changed, but no spec in $dir/ did" >> "$problems"
                case "$file" in
                    *.controller.ts)
                        touched '^apps/api/test/.+\.e2e-spec\.ts$' ||
                            echo "  API e2e:  $file changed, but nothing in apps/api/test/ did" >> "$problems"
                        ;;
                esac
                ;;
            apps/web/app/*page.tsx | apps/web/app/api/*route.ts)
                touched '^apps/e2e/tests/.+\.spec\.ts$' ||
                    echo "  browser:  $file changed, but nothing in apps/e2e/tests/ did" >> "$problems"
                ;;
        esac
    done

    [ -s "$problems" ] || continue

    subject="$(git log -1 --format=%s "$commit")"
    short="$(git rev-parse --short "$commit")"
    reason="$(git log -1 --format=%B "$commit" | sed -n 's/^Test-Layers-Skip:[[:space:]]*//p' | head -n 1)"

    if [ -n "$reason" ]; then
        echo "skipped $short $subject"
        echo "  reason:   $reason"
        cat "$problems"
    else
        echo "MISSING TESTS in $short $subject"
        cat "$problems"
        failures=$((failures + 1))
    fi
done

if [ "$failures" -gt 0 ]; then
    echo ""
    echo "$failures commit(s) change code without the tests for the layers they touch."
    echo "Add the tests to the same commit, or state why none are needed with a"
    echo "'Test-Layers-Skip: <reason>' trailer. See docs/ai/testing-strategy.md."
    exit 1
fi
echo "check-test-layers: every commit in $(git rev-parse --short "$BASE")..$(git rev-parse --short "$HEAD") carries its tests"
