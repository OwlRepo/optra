import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

// Runs once before any unit worker starts. Gives the unit layer its own
// database, recreated from the migrations every run - the same tool and the
// same reason as the two e2e layers: the dev database `optra` holds the demo
// seed, dev uploads and other runs' leftovers, and services under test sweep
// tables globally (e.g. IngestService.reconcileDocuments), so a shared
// database lets unrelated rows answer a test's question.
//
// Workers inherit process.env from this process, and dotenv (packages/db)
// never overrides a variable that is already set, so DATABASE_URL below is
// what every unit suite connects to. UNIT_DATABASE_URL overrides the base.
//
// TZ=UTC: timestamps are stored without a zone and Postgres runs in UTC, so a
// non-UTC Node reads freshly written rows as hours old. Production runs in
// UTC; so do the tests.

const UNIT_DATABASE = 'optra_unit'

export default function unitGlobalSetup(): void {
  process.env.TZ = 'UTC'

  const base =
    process.env.UNIT_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:54322/optra'
  const target = new URL(base)
  target.pathname = `/${UNIT_DATABASE}`
  const admin = new URL(base)
  admin.pathname = '/postgres'

  const prepare = spawnSync(
    'bun',
    [join(__dirname, '..', '..', 'e2e', 'scripts', 'prepare-db.ts'), UNIT_DATABASE],
    { env: { ...process.env, E2E_PG_ADMIN_URL: admin.toString() }, stdio: 'inherit' },
  )
  if (prepare.status !== 0) {
    throw new Error(`could not prepare ${UNIT_DATABASE} (prepare-db.ts exited ${prepare.status})`)
  }

  process.env.DATABASE_URL = target.toString()
}
