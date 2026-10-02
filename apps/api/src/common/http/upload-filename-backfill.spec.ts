import { readFileSync } from 'fs'
import { join } from 'path'
import { eq, like } from 'drizzle-orm'
import {
  catalogs,
  db,
  goodsReceipts,
  invoices,
  pool,
  purchaseOrders,
  users,
  vendors,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { decodeUploadFilename } from './upload-filename'

// Owner-approved 2026-10-03: names stored before B8 kept busboy's latin1
// reading of their UTF-8 bytes. Migration 0035 restores them in SQL, so this
// spec runs that exact file against the unit database and requires it to agree
// with decodeUploadFilename, the rule new uploads already follow, name for name.
const MIGRATION = join(__dirname, '../../../../../packages/db/drizzle/0035_white_ricochet.sql')
const asBusboyReadIt = (name: string) => Buffer.from(name, 'utf8').toString('latin1')

const NAMES = [
  asBusboyReadIt('façture-日本.csv'),
  asBusboyReadIt('Überweisung März.xlsx'),
  'café.csv',
  '日本-catalog.csv',
  'march-invoices.csv',
  // A character above U+FFFF: one code point in Postgres, two UTF-16 units in JS.
  'kit-\u{1F4E6}.csv',
]

describe('stored-name backfill, migration 0035 (B8 follow-up)', () => {
  const prefix = `name-backfill-spec-${Date.now()}-`

  afterAll(async () => {
    const owners = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
    for (const owner of owners) {
      const [workspace] = await db.select().from(workspaces).where(eq(workspaces.ownerId, owner.id))
      await db.delete(goodsReceipts).where(eq(goodsReceipts.workspaceId, workspace.id))
      await db.delete(invoices).where(eq(invoices.workspaceId, workspace.id))
      await db.delete(purchaseOrders).where(eq(purchaseOrders.workspaceId, workspace.id))
      await db.delete(catalogs).where(eq(catalogs.workspaceId, workspace.id))
      await db.delete(vendors).where(eq(vendors.workspaceId, workspace.id))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspace.id))
      await db.delete(workspaces).where(eq(workspaces.id, workspace.id))
    }
    await db.delete(users).where(like(users.email, `${prefix}%`))
    await pool.end()
  })

  it('edge: running the migration a second time changes nothing', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `${prefix}again@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db.insert(workspaces).values({ name: 'Backfill Again', ownerId: user.id }).returning()
    await db
      .insert(purchaseOrders)
      .values(NAMES.map((name) => ({ workspaceId: workspace.id, name, status: 'done' as const })))

    await pool.query(readFileSync(MIGRATION, 'utf8'))
    const once = (await db.select().from(purchaseOrders).where(eq(purchaseOrders.workspaceId, workspace.id)))
      .map((row) => row.name)
      .sort()
    await pool.query(readFileSync(MIGRATION, 'utf8'))
    const twice = (await db.select().from(purchaseOrders).where(eq(purchaseOrders.workspaceId, workspace.id)))
      .map((row) => row.name)
      .sort()

    expect(twice).toEqual(once)
  })

  it('regression: restores every pre-B8 name exactly as decodeUploadFilename would, in all four tables, and leaves correct names alone', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `${prefix}owner@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db.insert(workspaces).values({ name: 'Backfill', ownerId: user.id }).returning()
    const [vendor] = await db.insert(vendors).values({ workspaceId: workspace.id, name: 'Backfill Vendor' }).returning()
    const pos = await db
      .insert(purchaseOrders)
      .values(NAMES.map((name) => ({ workspaceId: workspace.id, name, status: 'done' as const })))
      .returning()
    await db.insert(invoices).values(NAMES.map((name) => ({ workspaceId: workspace.id, name, status: 'done' as const })))
    await db
      .insert(goodsReceipts)
      .values(NAMES.map((name) => ({ workspaceId: workspace.id, purchaseOrderId: pos[0].id, name, status: 'done' as const })))
    await db
      .insert(catalogs)
      .values(NAMES.map((name) => ({ workspaceId: workspace.id, vendorId: vendor.id, name, status: 'done' as const })))

    await pool.query(readFileSync(MIGRATION, 'utf8'))

    const expected = NAMES.map(decodeUploadFilename).sort()
    const namesIn = async (table: typeof purchaseOrders | typeof invoices | typeof goodsReceipts | typeof catalogs) =>
      (await db.select({ name: table.name }).from(table).where(eq(table.workspaceId, workspace.id)))
        .map((row) => row.name)
        .sort()
    expect(expected).toContain('façture-日本.csv')
    expect(expected).toContain('Überweisung März.xlsx')
    expect(await namesIn(purchaseOrders)).toEqual(expected)
    expect(await namesIn(invoices)).toEqual(expected)
    expect(await namesIn(goodsReceipts)).toEqual(expected)
    expect(await namesIn(catalogs)).toEqual(expected)
  })
})
