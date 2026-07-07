#!/bin/bash
# Enforce the Plan Contract before source code edits.
#
# Blocks Edit/Write/MultiEdit tool calls unless .claude/.plan-ack exists,
# is fresh, and records the current task's size + plan status. Companion
# to check-predict-verify.sh (Learning Contract). This does NOT judge plan
# quality — it forces the classification and plan-approval step to be
# recorded before any code change, instead of silently skipped.

ACK_FILE=".claude/.plan-ack"
MAX_AGE_SECONDS=14400   # one plan approval covers an implementation session (~4h)

# Read the tool call payload from stdin (Claude Code passes tool_input as JSON)
INPUT=$(cat)
TARGET_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')

# Same exemptions as check-predict-verify.sh — docs/config/markdown are not gated.
case "$TARGET_PATH" in
  *docs/ai/*|*learnings.md|*CLAUDE.md|*.claude/*|*README*|*.md)
    echo '{}'
    exit 0
    ;;
esac

if [ ! -f "$ACK_FILE" ]; then
  cat >&2 <<'MSG'
BLOCKED: no plan acknowledgment found.

Before editing source code, record the Plan Contract state in .claude/.plan-ack:
- Tiny/Express task  -> {"size":"tiny|express","plan":"not-required","blast_radius":"<files or none>"}
- Standard/Deep task -> {"size":"standard|deep","plan":"approved","matrices":"present"}

A Standard/Deep task must not reach implementation without an approved
two-layer plan (Risk Matrix + Backward Compatibility Matrix). Go back and plan.
MSG
  echo '{"permissionDecision":"deny","message":"No plan acknowledgment. See stderr for what to write to .claude/.plan-ack."}'
  exit 0
fi

ACK_MTIME=$(stat -c %Y "$ACK_FILE" 2>/dev/null || stat -f %m "$ACK_FILE" 2>/dev/null)
NOW=$(date +%s)
AGE=$(( NOW - ACK_MTIME ))

if [ "$AGE" -gt "$MAX_AGE_SECONDS" ]; then
  echo '{"permissionDecision":"deny","message":"plan acknowledgment is stale (older than 4h). Reclassify THIS task and rewrite .claude/.plan-ack before editing."}'
  exit 0
fi

# Standard/Deep requires an approved plan, not just any ack.
if grep -q '"size"[[:space:]]*:[[:space:]]*"standard"\|"size"[[:space:]]*:[[:space:]]*"deep"' "$ACK_FILE" && ! grep -q '"plan"[[:space:]]*:[[:space:]]*"approved"' "$ACK_FILE"; then
  echo '{"permissionDecision":"deny","message":"Standard/Deep task without an approved plan. Produce the two-layer plan (Risk + Backward Compatibility matrices), get approval, then set plan:approved in .claude/.plan-ack."}'
  exit 0
fi

echo '{}'
