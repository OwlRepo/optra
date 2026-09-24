# Restoring Optra from a backup

Written to be followed when something has already gone wrong, so it is in the order you
would actually do it, and each step says what it is protecting you from.

**Before you start, know which failure you have.** They need different things:

| What happened | What you need | Start at |
|---|---|---|
| Bad migration, accidental delete, corrupt data | The database, from before it happened | Step 0 |
| VPS disk died, droplet destroyed | A new box first, then the database | Step 1 |
| Uploaded files missing | Nothing — objects live in B2 and are not in these dumps | [Objects](#objects) |

---

## Step 0 — find a backup you trust

On the server, the newest seven are local:

```bash
ls -1 /home/deploy/apps/optra-backups/
# optra-2026-09-24T031700Z.dump
```

Older ones, or any at all if the box is gone, are in B2 under
`s3://optra-prod-backups/YYYY-MM-DD/`. The filename timestamp is **UTC**, so sort order
is chronological — pick the newest one from *before* the damage, not simply the newest.

> The backup application key is **write-only**. It cannot list or download. Use a
> read-capable key from the B2 console, or download through the web UI. That restriction
> is deliberate: it is what stops a compromised server from destroying its own backups.

Every dump in that directory has already been restored once, into a throwaway database,
at the moment it was taken — that is what `scripts/backup.sh` does before it reports
success. A file being there means it restored at least once.

## Step 1 — only if the server is gone

Rebuild the host by following `DEPLOYMENT.md` → *Production Deployment*, through the
first deploy. Let it come up empty, then continue below.

## Step 2 — restore the database

The dumps are `pg_dump` **custom format**, not plain SQL. `psql <` will not read them;
`pg_restore` does.

```bash
cd /home/deploy/apps/optra
BACKUP=/home/deploy/apps/optra-backups/optra-2026-09-24T031700Z.dump   # yours

# Copy it into the container, which is where pg_restore lives.
docker compose -f docker-compose.prod.yml cp "$BACKUP" postgres:/tmp/restore.dump
```

**Restore into a new database first and look at it.** Restoring straight over the live
one destroys the evidence of what went wrong, and cannot be undone:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'createdb -U "$POSTGRES_USER" optra_restore && \
         pg_restore -U "$POSTGRES_USER" -d optra_restore /tmp/restore.dump'

# Does it contain what you expect?
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d optra_restore -c "\
    select (select count(*) from workspaces) as workspaces, \
           (select count(*) from purchase_orders) as purchase_orders, \
           (select count(*) from comparison_runs) as comparison_runs"'
```

If those numbers are right, swap it in. Stop the app first so nothing writes during the
switch:

```bash
docker compose -f docker-compose.prod.yml stop api web

docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d postgres -c \
    "alter database \"$POSTGRES_DB\" rename to optra_broken_$(date -u +%Y%m%d)"'
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d postgres -c \
    "alter database optra_restore rename to \"$POSTGRES_DB\""'

docker compose -f docker-compose.prod.yml start api web
```

Renaming rather than dropping is the point: `optra_broken_<date>` is still there if the
restore turns out to be from the wrong moment. Drop it once you are certain, not before.

## Step 3 — confirm the application agrees

A restored database the app cannot use is not a restore.

```bash
docker compose -f docker-compose.prod.yml exec -T api \
  curl -fsS http://127.0.0.1:3001/health
```

Then in a browser: sign in, open a workspace, open **Discrepancies** and confirm flags
are listed, and open a purchase order's **Source** download. That last one crosses into
object storage, which the next section explains.

## Objects

**Uploaded files are not in these dumps and never were.** They live in Backblaze B2
(`optra-prod-objects`), which is replicated and off-box by construction — so a dead VPS
does not touch them, and there is nothing to restore.

The database stores only the object key. After a database restore, files reappear
because those keys point at B2 objects that never went anywhere.

The one case worth knowing: if a file was **deleted** from B2 rather than lost with the
server, bucket versioning keeps prior versions for 30 days. Recover it from the B2
console under the bucket's file history.

## What this does not cover

- **Point-in-time recovery.** Backups are daily, plus one per deploy. The most you can
  lose is a day of changes; there is no WAL archive to replay past the last dump.
- **Alerting.** A failed backup is a failed GitHub Actions run, which emails you. Nothing
  else watches. If you have not seen a run in a while, check whether GitHub disabled the
  schedule — it does that quietly after 60 days of repository inactivity.
- **Redis.** Caches and queues are not backed up. They rebuild themselves; jobs in flight
  at the moment of failure are lost, and the affected documents can be re-uploaded or
  re-compared.
