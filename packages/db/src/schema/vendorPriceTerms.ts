import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { index, numeric, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'
import { vendors } from './vendors'
import { workspaces } from './workspaces'

/**
 * What a vendor agreed an item would cost, and for how long (S9).
 *
 * POLICY v1 #5 keeps the **approved PO unit price** authoritative for the
 * PO-vs-invoice comparison. These rows do not change that: they answer a
 * different question — was the price we ordered at the one we had agreed? — so
 * a disagreement here is our own purchasing control finding, never a dispute
 * with the vendor.
 *
 * Deliberately NOT a catalog price. §12 lists "catalog scrape as authoritative
 * price truth" and "a single `catalog_price` field as contract model" as
 * non-goals, and `catalog_items` carries no price at all.
 *
 * Deliberately lean, per §6 1C's own warning that "correct price" semantics
 * vary by customer: no `price_type`, no quantity-tier bounds, no
 * tax/freight-inclusion flags. POLICY v1 #6 puts tiers, tax, freight and
 * discounts out of v1 comparison, so those columns would have no writer and no
 * reader — the same reason S5 refused `extraction_confidence` on receipts.
 * Every column below is written on day one.
 *
 * Append-only, like `comparison_runs` and `discrepancy_decisions`. A term is
 * never edited and never deleted; a new price closes the old one's window and
 * links back through `supersedesId`, so what a past comparison was judged
 * against stays readable forever.
 */
export const vendorPriceTerms = pgTable(
  'vendor_price_terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    // Cascade, matching `catalogs`: a term without its vendor identifies
    // nothing. There is no delete-vendor route today, so this is a statement of
    // meaning rather than a live path.
    vendorId: uuid('vendor_id')
      .references(() => vendors.id, { onDelete: 'cascade' })
      .notNull(),
    // The SKU exactly as the agreement states it — evidence, shown to a human.
    sku: varchar('sku', { length: 200 }).notNull(),
    // The same SKU lower-cased, which is what matching actually uses, because
    // the comparison engine's match key is `sku::<lower>` (`matchKey()`).
    // Stored rather than expressed as a `lower(sku)` index so the lookup is a
    // plain b-tree that drizzle-kit can generate and the snapshot can hold.
    //
    // NOT NULL, and that is a real limitation worth stating here rather than
    // discovering later: the engine falls back to `desc::<lower>` when a line
    // has no SKU, so a purchase-order line keyed only by free-text description
    // is never contract-checked. A contract keyed by description is not
    // evidence anybody should act on.
    skuKey: varchar('sku_key', { length: 200 }).notNull(),
    // Null means the agreement did not state a unit — never a unit of its own.
    // POLICY v1 #4: units are captured, never converted.
    uom: varchar('uom', { length: 20 }),
    unitPrice: numeric('unit_price').notNull(),
    // NOT NULL, unlike `purchase_orders.currency`. That column had to tolerate
    // rows written before migration 0025; this table is new and has none, so
    // "a price means nothing without its currency" is expressed in the schema.
    currency: varchar('currency', { length: 10 }).notNull(),
    // Half-open window: [effective_from, effective_to). A null upper bound is
    // an open-ended term. The strict upper bound is what leaves exactly one
    // live term at the instant one supersedes another.
    effectiveFrom: timestamp('effective_from').notNull(),
    effectiveTo: timestamp('effective_to'),
    // Where the number came from, in the human's own words — "MSA-2026-04 §3
    // rev 2". Free text on purpose: there is no contract-document pipeline, and
    // inventing an FK to a table that does not exist would be worse than
    // admitting the evidence here is a citation rather than stored bytes.
    sourceReference: text('source_reference'),
    // Self-referencing: which term this one replaced, so the chain of what a
    // vendor charged over time is walkable rather than inferred from dates.
    // `set null` because the chain is history, and losing a link must degrade
    // the trail, not delete the row holding it.
    supersedesId: uuid('supersedes_id').references((): AnyPgColumn => vendorPriceTerms.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // Serves the hot query: every term for one vendor and item, newest window
    // first, so applicability is one indexed read per purchase-order line.
    lookupIdx: index('vendor_price_terms_lookup_idx').on(
      table.workspaceId,
      table.vendorId,
      table.skuKey,
      table.effectiveFrom,
    ),
    workspaceVendorIdx: index('vendor_price_terms_workspace_vendor_idx').on(table.workspaceId, table.vendorId),
    // NO unique index guards "at most one open-ended term per item". That is
    // enforced in `VendorPriceTermsService.create`, which closes the previous
    // open term inside the same transaction as the insert.
    //
    // It was tried in the schema first and removed on evidence. drizzle-kit
    // 0.20 accepts `.where()` on a unique index — the builder types it, the
    // compiler is happy — and then **drops the clause when generating the
    // migration**, emitting a FULL unique index instead of a partial one. That
    // is not a missing feature, it is a silent inversion: a full unique index
    // on (workspace, vendor, sku_key, currency) would reject every legitimate
    // superseded term, which is exactly the history this table exists to keep.
    // A `sql` expression in the column list fares worse still and emits
    // syntactically invalid SQL.
    //
    // The general constraint — no two windows overlapping at any instant —
    // needs `btree_gist` and `EXCLUDE USING gist (… WITH &&)`, which
    // drizzle-kit cannot express at all. Hand-writing either into a generated
    // migration would put it outside the snapshot and drift on the next
    // `db:generate`, so the invariant lives in the one writer instead.
  }),
)

export type VendorPriceTerm = typeof vendorPriceTerms.$inferSelect
export type NewVendorPriceTerm = typeof vendorPriceTerms.$inferInsert
