import { Injectable, NotFoundException } from '@nestjs/common'
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import {
  buildOffsetResult,
  db,
  discrepancyFlags,
  poLineItems,
  purchaseOrders,
  resolveOffsetPage,
  vendorPriceTerms,
  vendors,
} from '@repo/db'

/** Zero-filled so a caller can render every type without guarding for absence. */
const EMPTY_COUNTS: Record<string, number> = {
  quantity_mismatch: 0,
  price_mismatch: 0,
  missing_on_invoice: 0,
  missing_on_po: 0,
  short_receipt: 0,
  invoice_exceeds_received: 0,
  uom_mismatch: 0,
  currency_mismatch: 0,
  contract_price_variance: 0,
  contract_price_unavailable: 0,
}

/**
 * What this vendor has charged over time, and what has gone wrong with them.
 *
 * Read-only, member-visible, and deliberately free of averages. An average
 * unit price across quarters would silently mix units and currencies, which is
 * exactly what POLICY v1 #4 and #6 forbid comparing — so this returns the
 * observations in order and lets the reader see the shape. First, latest and
 * change are computed from these rows by whoever renders them.
 */
@Injectable()
export class VendorHistoryService {
  async get(workspaceId: string, vendorId: string) {
    return this.assertVendorInWorkspace(workspaceId, vendorId)
  }

  async priceHistory(
    workspaceId: string,
    vendorId: string,
    filters: { sku?: string; page?: string; pageSize?: string },
  ) {
    await this.assertVendorInWorkspace(workspaceId, vendorId)
    const { page, pageSize, offset } = resolveOffsetPage(filters.page, filters.pageSize)

    const scope = and(eq(purchaseOrders.workspaceId, workspaceId), eq(purchaseOrders.vendorId, vendorId))

    // Every item ever bought from this vendor, independent of the filter — a
    // SKU list that narrowed with the filter could never be widened again
    // without clearing it first.
    const skuRows = await db
      .selectDistinct({ sku: poLineItems.sku })
      .from(poLineItems)
      .innerJoin(purchaseOrders, eq(poLineItems.purchaseOrderId, purchaseOrders.id))
      .where(scope)
      .orderBy(asc(poLineItems.sku))
    const skus = skuRows.map((row) => row.sku).filter((sku): sku is string => sku !== null)

    const skuFilter = filters.sku?.trim().toLowerCase()
    const where = skuFilter
      ? and(scope, inArray(poLineItems.sku, skus.filter((sku) => sku.toLowerCase() === skuFilter)))
      : scope

    const [{ total }] = await db
      .select({ total: count() })
      .from(poLineItems)
      .innerJoin(purchaseOrders, eq(poLineItems.purchaseOrderId, purchaseOrders.id))
      .where(where)

    const rows = await db
      .select({
        poLineItemId: poLineItems.id,
        purchaseOrderId: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        poName: purchaseOrders.name,
        currency: purchaseOrders.currency,
        orderedAt: purchaseOrders.orderedAt,
        recordedAt: purchaseOrders.createdAt,
        sku: poLineItems.sku,
        uom: poLineItems.uom,
        quantity: poLineItems.quantity,
        unitPrice: poLineItems.unitPrice,
      })
      .from(poLineItems)
      .innerJoin(purchaseOrders, eq(poLineItems.purchaseOrderId, purchaseOrders.id))
      .where(where)
      // `id` is the tiebreak, not tidiness: several orders can share a date,
      // and OFFSET over a non-total order repeats some rows and drops others.
      .orderBy(desc(purchaseOrders.orderedAt), desc(purchaseOrders.createdAt), asc(poLineItems.id))
      .limit(pageSize)
      .offset(offset)

    const terms = await db
      .select()
      .from(vendorPriceTerms)
      .where(and(eq(vendorPriceTerms.workspaceId, workspaceId), eq(vendorPriceTerms.vendorId, vendorId)))

    const items = rows.map((row) => ({
      ...row,
      // The price agreed for THIS order's date, not whichever term happens to
      // be open today. Same half-open window and same refusal to choose
      // between overlapping terms as `ComparisonService#contractPriceFlags`;
      // null here means "no single agreed price applied", never a guess.
      contractUnitPrice: this.agreedPriceAt(terms, row.sku, row.orderedAt ?? row.recordedAt),
    }))

    return { ...buildOffsetResult(items, Number(total), page, pageSize), skus }
  }

  async exceptionSummary(workspaceId: string, vendorId: string) {
    await this.assertVendorInWorkspace(workspaceId, vendorId)

    const scope = and(eq(purchaseOrders.workspaceId, workspaceId), eq(purchaseOrders.vendorId, vendorId))

    const [{ purchaseOrderCount }] = await db
      .select({ purchaseOrderCount: count() })
      .from(purchaseOrders)
      .where(scope)

    const grouped = await db
      .select({ flagType: discrepancyFlags.flagType, total: count() })
      .from(discrepancyFlags)
      .innerJoin(purchaseOrders, eq(discrepancyFlags.purchaseOrderId, purchaseOrders.id))
      .where(and(scope, eq(discrepancyFlags.workspaceId, workspaceId)))
      .groupBy(discrepancyFlags.flagType)

    const counts = { ...EMPTY_COUNTS }
    for (const row of grouped) counts[row.flagType] = Number(row.total)

    const [{ openTotal }] = await db
      .select({ openTotal: count() })
      .from(discrepancyFlags)
      .innerJoin(purchaseOrders, eq(discrepancyFlags.purchaseOrderId, purchaseOrders.id))
      .where(and(scope, eq(discrepancyFlags.workspaceId, workspaceId), eq(discrepancyFlags.status, 'open')))

    // A vendor with no exceptions reports zeroes, not an absence. Phase 3's own
    // rule: missing data is distinct from good performance, and a caller has to
    // be able to tell "nothing went wrong" from "we have never looked".
    return { counts, openTotal: Number(openTotal), purchaseOrderCount: Number(purchaseOrderCount) }
  }

  private agreedPriceAt(
    terms: (typeof vendorPriceTerms.$inferSelect)[],
    sku: string | null,
    at: Date,
  ): string | null {
    const key = sku?.trim().toLowerCase()
    if (!key) return null
    const live = terms.filter(
      (term) =>
        term.skuKey === key && term.effectiveFrom <= at && (term.effectiveTo === null || term.effectiveTo > at),
    )
    return live.length === 1 ? live[0].unitPrice : null
  }

  private async assertVendorInWorkspace(workspaceId: string, vendorId: string) {
    const [vendor] = await db
      .select({ id: vendors.id, name: vendors.name, contactInfo: vendors.contactInfo, createdAt: vendors.createdAt })
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.workspaceId, workspaceId)))
      .limit(1)

    if (!vendor) throw new NotFoundException('Vendor not found')
    return vendor
  }
}
