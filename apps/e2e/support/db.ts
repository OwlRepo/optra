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
