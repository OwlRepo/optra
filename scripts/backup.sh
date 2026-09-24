#!/bin/sh
# Back up the production database, and prove the backup would restore.
#
# Lives here rather than inline in .github/workflows/deploy.yml because the
# previous eleven lines could not be exercised without a production deploy —
# which meant nothing ever had. This runs by hand against any compose file:
#
#   BACKUP_DIR=/tmp/t sh scripts/backup.sh --reason=scheduled \
#     --compose-file=docker-compose.yml
#
# What it does NOT do, deliberately: delete anything in B2. The backup
# application key is created write-only, so a compromised VPS can add junk but
# cannot destroy history. Long-term expiry is a B2 lifecycle rule instead.
set -eu

REASON=""
COMPOSE_FILE="docker-compose.prod.yml"

for arg in "$@"; do
    case "$arg" in
        --reason=*) REASON="${arg#--reason=}" ;;
        --compose-file=*) COMPOSE_FILE="${arg#--compose-file=}" ;;
        *) echo "unknown argument: $arg" >&2; exit 2 ;;
    esac
done

case "$REASON" in
    deploy|scheduled) ;;
    *) echo "usage: $0 --reason=deploy|scheduled [--compose-file=PATH]" >&2; exit 2 ;;
esac

BACKUP_DIR="${BACKUP_DIR:-/home/deploy/apps/optra-backups}"
# How many dumps stay on the VPS. Long-term retention belongs to B2; this is
# only enough local history to roll back a bad deploy without a download.
BACKUP_KEEP="${BACKUP_KEEP:-7}"
# A restored database with almost no tables is a restore that silently did
# nothing. The real schema is 30+ tables, so this floor is generous on purpose:
# it catches "empty" without breaking every time a migration lands.
MIN_TABLES="${MIN_TABLES:-20}"
AWS_CLI_IMAGE="${AWS_CLI_IMAGE:-amazon/aws-cli:2.17.0}"

TIMESTAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
DUMP_NAME="optra-${TIMESTAMP}.dump"
CONTAINER_DUMP="/tmp/${DUMP_NAME}"
VERIFY_DB="optra_verify_$(date -u +%Y%m%d%H%M%S)"

compose() {
    docker compose -f "$COMPOSE_FILE" "$@"
}

# Runs a command inside the postgres container. Credentials come from the
# container's own environment, never from a file we read and pass along, so
# they cannot end up in this script's arguments or in a CI log.
in_postgres() {
    compose exec -T postgres sh -c "$1"
}

# --- 1. is there a database to back up? --------------------------------------
postgres_container_id="$(compose ps -q postgres || true)"

if [ -z "$postgres_container_id" ]; then
    if [ "$REASON" = "deploy" ]; then
        # A first-ever deploy has no container yet. Nothing exists to lose.
        echo "skipping backup: postgres container not running yet (first deploy)"
        exit 0
    fi
    # A SCHEDULED run that cannot find the database is the one case that must
    # be loud. Exiting 0 here would report a healthy backup every day while
    # backing up nothing at all.
    echo "postgres container is not running - no backup was taken" >&2
    exit 1
fi

mkdir -p "$BACKUP_DIR"

# Drop the throwaway verification database however this script exits, including
# on failure part-way through the restore.
cleanup() {
    in_postgres "dropdb -U \"\$POSTGRES_USER\" --if-exists '$VERIFY_DB'" >/dev/null 2>&1 || true
    in_postgres "rm -f '$CONTAINER_DUMP'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- 2. dump -----------------------------------------------------------------
# Custom format (-Fc): compressed, and the only format pg_restore can list and
# selectively restore. The dump is written inside the container so the next two
# steps can verify it where pg_restore already exists, rather than assuming the
# host has PostgreSQL client tools installed.
echo "dumping database to $DUMP_NAME"
in_postgres "pg_dump -Fc -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -f '$CONTAINER_DUMP'"

# --- 3. does the archive parse? ----------------------------------------------
# The check this replaces was `test -s`, which passes on a dump truncated
# half-way through. Listing the archive's table of contents fails on a
# truncated or corrupt file.
echo "verifying archive structure"
in_postgres "pg_restore --list '$CONTAINER_DUMP' > /dev/null"

# --- 4. does it actually restore? --------------------------------------------
# The difference between having backups and having restorable ones. Restored
# into a uniquely-named throwaway database that is dropped in the trap above;
# the live database is never written to.
case "$VERIFY_DB" in
    optra_verify_*) ;;
    *) echo "refusing to restore into a database that is not a throwaway" >&2; exit 1 ;;
esac

echo "test-restoring into $VERIFY_DB"
in_postgres "createdb -U \"\$POSTGRES_USER\" '$VERIFY_DB'"
# No --exit-on-error: a restore into a fresh database legitimately warns about
# things like extension ownership, and failing on those would make this step
# cry wolf. The table count below is the assertion that actually matters —
# it proves objects arrived, which no warning can fake.
in_postgres "pg_restore -U \"\$POSTGRES_USER\" -d '$VERIFY_DB' '$CONTAINER_DUMP'" >/dev/null 2>&1 || true

table_count="$(in_postgres "psql -U \"\$POSTGRES_USER\" -d '$VERIFY_DB' -tAc \"select count(*) from information_schema.tables where table_schema = 'public'\"" | tr -d '[:space:]')"

if [ -z "$table_count" ] || [ "$table_count" -lt "$MIN_TABLES" ]; then
    echo "restore produced ${table_count:-0} tables, expected at least $MIN_TABLES" >&2
    exit 1
fi
echo "restored $table_count tables from the backup"

# --- 5. keep it on the host ---------------------------------------------------
docker cp "$postgres_container_id:$CONTAINER_DUMP" "$BACKUP_DIR/$DUMP_NAME"

# --- 6. put a copy somewhere the VPS cannot reach -----------------------------
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
    echo "uploading to s3://$BACKUP_S3_BUCKET/$(date -u +%F)/$DUMP_NAME"
    # Credentials are passed as environment variables to a throwaway container
    # rather than written to a config file on the box.
    docker run --rm \
        -v "$BACKUP_DIR:/backup:ro" \
        -e AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY:-}" \
        -e AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:-}" \
        "$AWS_CLI_IMAGE" \
        s3 cp "/backup/$DUMP_NAME" "s3://$BACKUP_S3_BUCKET/$(date -u +%F)/$DUMP_NAME" \
        --endpoint-url "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is required when BACKUP_S3_BUCKET is set}"
    echo "off-box copy stored"
else
    # Not a failure: the script is useful without B2, and a run that exits
    # non-zero here would turn "not configured yet" into a daily false alarm.
    # It is loud, though - a backup nobody can reach after a disk dies is not
    # a backup, and that fact should not be discoverable only by reading code.
    echo "WARNING: BACKUP_S3_BUCKET is not set - every copy of this backup is on the VPS disk."
    echo "WARNING: set BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY and BACKUP_S3_SECRET_KEY to fix that."
fi

# --- 7. prune local copies ----------------------------------------------------
# By count, never by age alone. `find -mtime +N` with no floor deletes every
# backup you have the first time nothing is deployed for N days.
#
# Sorted by NAME, not by mtime, and that is deliberate twice over: the
# timestamp in the filename is UTC and zero-padded, so lexicographic order is
# chronological order; and mtime is set by `docker cp`, which makes it a
# property of when the file was copied rather than when the backup was taken.
find "$BACKUP_DIR" -maxdepth 1 -name 'optra-*.dump' 2>/dev/null | sort -r | tail -n "+$((BACKUP_KEEP + 1))" | while IFS= read -r stale; do
    echo "removing old local backup: $(basename "$stale")"
    rm -f "$stale"
done

# Transitional: plain-SQL dumps written by the pre-2026-09-24 deploy step, which
# pruned them with `find -mtime +14`. Nothing creates these any more, so without
# this they would sit on the VPS forever once that step was removed. Delete this
# block once the directory holds no .sql files.
find "$BACKUP_DIR" -maxdepth 1 -name 'optra-*.sql' -mtime +14 -delete 2>/dev/null || true

echo "$DUMP_NAME is $(du -h "$BACKUP_DIR/$DUMP_NAME" | cut -f1); $BACKUP_DIR now holds $(du -sh "$BACKUP_DIR" | cut -f1)"
