import { randomUUID } from 'node:crypto'
import bcrypt from 'bcrypt'
import { Pool } from 'pg'
import { DATABASE_URL } from './env'

// Plain SQL rather than @repo/db: the harness then depends on the schema,
// not on a built `dist`, and seeding stays readable as the rows it creates.
// Everything here runs against the throwaway `optra_pw` database, which
// scripts/prepare-db.ts recreates before every run.

let pool: Pool | undefined

function db(): Pool {
  pool ??= new Pool({ connectionString: DATABASE_URL, max: 4 })
  return pool
}

export async function closeDb(): Promise<void> {
  await pool?.end()
  pool = undefined
}

export async function seedUser(input: {
  email: string
  password: string
  verified?: boolean
}): Promise<string> {
  // Cost 4, not the API's 10: the API only ever compares, and the cost is
  // stored in the hash itself.
  const hash = await bcrypt.hash(input.password, 4)
  const { rows } = await db().query<{ id: string }>(
    `insert into users (email, password_hash, is_verified) values ($1, $2, $3) returning id`,
    [input.email.toLowerCase(), hash, input.verified ?? true],
  )
  return rows[0].id
}

export async function seedWorkspace(ownerId: string, name: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into workspaces (name, owner_id) values ($1, $2) returning id`,
    [name, ownerId],
  )
  await addMember(rows[0].id, ownerId, 'owner')
  return rows[0].id
}

export async function addMember(
  workspaceId: string,
  userId: string,
  role: 'owner' | 'admin' | 'member',
): Promise<void> {
  await db().query(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)`,
    [workspaceId, userId, role],
  )
}

/** Moves a workspace to the bottom of `/workspaces/me` (newest first). */
export async function backdateWorkspace(workspaceId: string): Promise<void> {
  await db().query(`update workspaces set created_at = now() - interval '30 days' where id = $1`, [workspaceId])
}

export async function seedVendor(workspaceId: string, name: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into vendors (workspace_id, name) values ($1, $2) returning id`,
    [workspaceId, name],
  )
  return rows[0].id
}

export async function seedKnowledgeBase(workspaceId: string, name: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into knowledge_bases (workspace_id, name) values ($1, $2) returning id`,
    [workspaceId, name],
  )
  return rows[0].id
}

/** The newest unused OTP for an email. OTPs are stored in plaintext. */
export async function latestOtp(email: string): Promise<string> {
  const { rows } = await db().query<{ code: string }>(
    `select o.code from otps o join users u on u.id = o.user_id
      where u.email = $1 and o.used_at is null
      order by o.created_at desc limit 1`,
    [email.toLowerCase()],
  )
  if (!rows[0]) throw new Error(`no OTP issued for ${email}`)
  return rows[0].code
}

export type StoredTable =
  | 'purchase_orders'
  | 'invoices'
  | 'goods_receipts'
  | 'documents'
  | 'datasets'
  | 'catalogs'

/** Where a row's file lives. Lets a test prove bytes left storage, or remove them. */
export async function storageKeyOf(table: StoredTable, id: string): Promise<string | null> {
  const { rows } = await db().query<{ storage_key: string | null }>(
    `select storage_key from ${table} where id = $1`,
    [id],
  )
  return rows[0]?.storage_key ?? null
}

export async function rowExists(table: StoredTable, id: string): Promise<boolean> {
  const { rowCount } = await db().query(`select 1 from ${table} where id = $1`, [id])
  return (rowCount ?? 0) > 0
}

export async function photoKeysOfCatalog(catalogId: string): Promise<{ id: string; key: string }[]> {
  const { rows } = await db().query<{ id: string; photo_storage_key: string }>(
    `select id, photo_storage_key from catalog_items
      where catalog_id = $1 and photo_storage_key is not null
      order by line_number`,
    [catalogId],
  )
  return rows.map((row) => ({ id: row.id, key: row.photo_storage_key }))
}

/**
 * Sets a workspace's billing state without going through signup or a webhook.
 * `trialEndsInDays: null` clears the trial, a negative number puts it in the
 * past. Only the keys given are touched.
 */
export async function setWorkspaceBilling(
  workspaceId: string,
  state: { trialEndsInDays?: number | null; exempt?: boolean },
): Promise<void> {
  if ('trialEndsInDays' in state) {
    if (state.trialEndsInDays === null || state.trialEndsInDays === undefined) {
      await db().query(`update workspaces set trial_ends_at = null where id = $1`, [workspaceId])
    } else {
      await db().query(
        `update workspaces set trial_ends_at = now() + make_interval(days => $2::int) where id = $1`,
        [workspaceId, state.trialEndsInDays],
      )
    }
  }
  if (state.exempt !== undefined) {
    await db().query(`update workspaces set billing_exempt = $2 where id = $1`, [workspaceId, state.exempt])
  }
}

export interface SubscriptionRow {
  ls_subscription_id: string
  plan: string
  status: string
  seats: number
}

/** The workspace's subscription row, or null when no signed webhook has written one. */
export async function subscriptionFor(workspaceId: string): Promise<SubscriptionRow | null> {
  const { rows } = await db().query<SubscriptionRow>(
    `select ls_subscription_id, plan, status, seats from workspace_subscriptions where workspace_id = $1`,
    [workspaceId],
  )
  return rows[0] ?? null
}

export type UsageKind = 'matched_line' | 'photo_check' | 'llm_cost'

/**
 * Writes billing ledger rows straight into usage_events (slice S4), the way a
 * metered API call would. `occurredAt` defaults to now in UTC and is always
 * sent as an ISO string cast to timestamptz then to UTC, so the stored
 * zone-less timestamp never depends on this process's time zone. `key`
 * defaults to a random `seed:` key (the column is unique).
 */
export async function seedUsageEvents(
  workspaceId: string,
  rows: { kind: UsageKind; quantity: number; occurredAt?: Date; key?: string }[],
): Promise<void> {
  for (const row of rows) {
    await db().query(
      `insert into usage_events (workspace_id, kind, quantity, idempotency_key, occurred_at)
       values ($1, $2, $3, $4, coalesce(($5::timestamptz) at time zone 'utc', now() at time zone 'utc'))`,
      [
        workspaceId,
        row.kind,
        row.quantity,
        row.key ?? `seed:${randomUUID()}`,
        row.occurredAt ? row.occurredAt.toISOString() : null,
      ],
    )
  }
}

/** Per-kind sums of the workspace's ledger, ordered by kind. `quantity` is a string (bigint sums). */
export async function usageSummaryFor(workspaceId: string): Promise<{ kind: string; quantity: string }[]> {
  const { rows } = await db().query<{ kind: string; quantity: string }>(
    `select kind::text as kind, sum(quantity)::text as quantity
       from usage_events where workspace_id = $1 group by kind order by kind`,
    [workspaceId],
  )
  return rows
}

/**
 * A parsed purchase order and an invoice linked to it, inserted as `done` so
 * the procurement page offers the pair in its Compare selects. No line rows:
 * specs that use it stub the compare answer.
 */
export async function seedParsedPair(
  workspaceId: string,
  names: { purchaseOrder: string; invoice: string },
): Promise<{ purchaseOrderId: string; invoiceId: string }> {
  const po = await db().query<{ id: string }>(
    `insert into purchase_orders (workspace_id, name, status, row_count) values ($1, $2, 'done', 1) returning id`,
    [workspaceId, names.purchaseOrder],
  )
  const invoice = await db().query<{ id: string }>(
    `insert into invoices (workspace_id, name, status, row_count, purchase_order_id) values ($1, $2, 'done', 1, $3) returning id`,
    [workspaceId, names.invoice, po.rows[0].id],
  )
  return { purchaseOrderId: po.rows[0].id, invoiceId: invoice.rows[0].id }
}
