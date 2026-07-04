// Applies the versioned SQL migrations in ../drizzle (0000..NNNN) to DATABASE_URL.
// Use this instead of `drizzle-kit push` — push re-derives DDL from the schema and
// mis-quotes the custom `vector(1536)` type ("vector(1536)" -> type does not exist),
// and does not run the `CREATE EXTENSION vector` / hand-tuned index steps the
// migrations do. Migrations are the source of truth (see packages/db/drizzle).
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Container sets DATABASE_URL via compose; for host runs fall back to root .env.
// (dotenv does not override already-set env vars.)
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../../.env') })

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

async function main() {
  const pool = new Pool({ connectionString })
  const db = drizzle(pool)
  console.log(`running migrations from ${migrationsFolder} ...`)
  await migrate(db, { migrationsFolder })
  console.log('migrations complete')
  await pool.end()
}

main().catch((err) => {
  console.error('migration failed:', err)
  process.exit(1)
})
