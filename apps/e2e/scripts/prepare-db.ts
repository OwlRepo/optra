// Recreate an e2e database from nothing and apply every migration to it.
//
//   bun apps/e2e/scripts/prepare-db.ts optra_pw     # Playwright
//   bun apps/e2e/scripts/prepare-db.ts optra_e2e    # apps/api jest e2e (CI)
//
// Dropped and recreated every time, not merely migrated: the API re-enqueues
// stale `pending`/`processing` rows on boot, so a database carrying a previous
// run's rows would hand this run someone else's jobs. Only the two names above
// are accepted - this script must never be able to drop the dev `optra` DB.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { Client } from 'pg'

const ALLOWED = new Set(['optra_pw', 'optra_e2e'])
const name = process.argv[2]

if (!name || !ALLOWED.has(name)) {
  console.error(`usage: prepare-db.ts <${[...ALLOWED].join('|')}>`)
  process.exit(2)
}

const adminUrl =
  process.env.E2E_PG_ADMIN_URL ?? 'postgresql://postgres:postgres@localhost:54322/postgres'
const target = new URL(adminUrl)
target.pathname = `/${name}`

async function main(): Promise<void> {
  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid()`,
      [name],
    )
    // Identifier, not a parameter - safe because `name` is from the allowlist.
    await admin.query(`drop database if exists "${name}"`)
    await admin.query(`create database "${name}"`)
  } finally {
    await admin.end()
  }

  const migrate = spawnSync('bun', ['run', 'db:migrate'], {
    cwd: join(__dirname, '..', '..', '..', 'packages', 'db'),
    env: { ...process.env, DATABASE_URL: target.toString() },
    stdio: 'inherit',
  })
  if (migrate.status !== 0) {
    console.error(`migrations failed for ${name}`)
    process.exit(migrate.status ?? 1)
  }
  console.log(`${name} recreated and migrated`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
