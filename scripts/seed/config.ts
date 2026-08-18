// Fixed identity for the demo tenant.
//
// These UUIDs are pinned (not randomly generated) for two reasons:
//   1. Idempotency — every re-seed deletes exactly the rows belonging to this
//      workspace/user and nothing else. No TRUNCATE, no wildcard deletes, so
//      any other data in the local DB survives untouched.
//   2. Stable URLs — /workspaces/<id> stays the same across re-seeds, so
//      browser tabs kept open during a demo keep working.

export const DEMO_USER_ID = 'a0000000-0000-4000-8000-000000000001'
export const DEMO_TEAMMATE_ID = 'a0000000-0000-4000-8000-000000000002'
export const DEMO_WORKSPACE_ID = 'b0000000-0000-4000-8000-000000000001'

export const KB_PRODUCT_DOCS_ID = 'c0000000-0000-4000-8000-000000000001'
export const KB_HELP_CENTER_ID = 'c0000000-0000-4000-8000-000000000002'
export const KB_RUNBOOKS_ID = 'c0000000-0000-4000-8000-000000000003'

export const DEMO_USER_EMAIL = 'demo@heliolabs.io'
export const DEMO_TEAMMATE_EMAIL = 'priya@heliolabs.io'
export const DEMO_PASSWORD = 'DemoPass123!'

export const DEMO_WORKSPACE_NAME = 'Helio Labs — Support'

// docker-compose.yml maps postgres 54322:5432 and redis 6380:6379. DOCKER.md
// still documents the older 54321/6379 pair and .env sets REDIS_PORT=6379
// (correct inside the container, wrong from the host) — hence the explicit
// host-side defaults here rather than reading REDIS_PORT.
export const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@localhost:54322/optra'
export const DEFAULT_REDIS_HOST = 'localhost'
export const DEFAULT_REDIS_PORT = 6380

// Hosts the seeder is willing to write to without an explicit override. The
// seeder deletes rows; pointing it at the production VPS via a stray
// DATABASE_URL in the environment would be unrecoverable.
export const ALLOWED_DB_HOSTS = ['localhost', '127.0.0.1', '::1', 'postgres', 'optra-db']

export const EMBEDDING_DIMENSION = 1536

/** Timestamp helpers so seeded data always looks recent relative to run time. */
export function daysAgo(days: number, hourOfDay = 10): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(hourOfDay, (days * 7) % 60, (days * 13) % 60, 0)
  return d
}

export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000)
}

export function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60 * 1000)
}
