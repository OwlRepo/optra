#!/bin/sh
# Fresh task worktree per docs/ai/execution.md: fetch origin first, branch from
# the base ref, never reuse a stale worktree. The base defaults to origin/main;
# a stacked slice passes its parent branch (e.g. origin/feat/s9-price-vendor-history).
set -eu

usage="Usage: scripts/new-task-worktree.sh <fix|feat|enhancement|refactor|perf|infra> <short-name> [base-ref]"

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "$usage" >&2
  exit 1
fi

type="$1"
name="$2"
base="${3:-origin/main}"

case "$type" in
  fix|feat|enhancement|refactor|perf|infra) ;;
  *)
    echo "Invalid type '$type'. Use: fix|feat|enhancement|refactor|perf|infra" >&2
    exit 1
    ;;
esac

case "$name" in
  ""|*/*|*" "*)
    echo "Invalid short-name '$name': use kebab-case, no slashes or spaces." >&2
    exit 1
    ;;
esac

# Resolve the MAIN repo root even when invoked from inside a worktree
# (--show-toplevel would return the worktree root and nest worktrees).
common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
root="$(dirname "$common_dir")"
branch="$type/no-ticket-$name"
dir="$root/.claude/worktrees/$type-$name"

if [ -e "$dir" ]; then
  echo "Worktree directory already exists: $dir" >&2
  exit 1
fi

git fetch origin

if ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
  echo "Base ref '$base' does not resolve to a commit (after git fetch origin)." >&2
  exit 1
fi

git worktree add "$dir" -b "$branch" "$base"

echo ""
echo "Worktree ready on $branch (base: $base). Next:"
echo "  cd $dir"
echo "  nvm use                          # Node 22 from .nvmrc"
echo "  bun install --frozen-lockfile"
echo "  cp $root/.env .env               # untracked; tests and compose need it"
if [ "$base" != "origin/main" ]; then
  echo "  export TDD_RED_BASE=$base   # stacked slice: bun run tdd:red diffs against the parent"
fi
