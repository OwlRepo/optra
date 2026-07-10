import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import Papa from 'papaparse'
import {
  db,
  discrepancyFlags,
  invoiceLineItems,
  invoices,
  poLineItems,
  purchaseOrders,
  type DiscrepancyFlag,
} from '@repo/db'
import { DuckDbQueryService } from '../structured-query/duckdb-query.service'

const PO_TABLE = 'po_items'
const INV_TABLE = 'inv_items'

// Fixed, hand-written template — never built from row data. Row values only
// ever enter via CSV loaded by DuckDbQueryService's trusted read_csv_auto
// BEFORE enable_external_access=false; this string is the entire "SQL
// surface" here and is still re-validated by assertReadOnlySelect() as
// defense-in-depth. SKU match key falls back to normalized description
// when a side has no SKU (COALESCE+NULLIF), matching the approved match
// strategy.
const COMPARISON_SQL = `
WITH po AS (
  SELECT id AS po_line_item_id, sku AS po_sku, description AS po_desc,
         TRY_CAST(quantity AS DOUBLE) AS po_qty, TRY_CAST(unit_price AS DOUBLE) AS po_price,
         COALESCE(NULLIF(lower(trim(CAST(sku AS VARCHAR))), ''), 'desc::' || lower(trim(CAST(description AS VARCHAR)))) AS mk
  FROM ${PO_TABLE}
),
inv AS (
  SELECT id AS invoice_line_item_id, sku AS inv_sku, description AS inv_desc,
         TRY_CAST(quantity AS DOUBLE) AS inv_qty, TRY_CAST(unit_price AS DOUBLE) AS inv_price,
         COALESCE(NULLIF(lower(trim(CAST(sku AS VARCHAR))), ''), 'desc::' || lower(trim(CAST(description AS VARCHAR)))) AS mk
  FROM ${INV_TABLE}
),
joined AS (
  SELECT p.po_line_item_id, i.invoice_line_item_id,
         COALESCE(p.po_sku, i.inv_sku) AS sku, p.po_qty, i.inv_qty, p.po_price, i.inv_price,
         CASE
           WHEN p.mk IS NULL THEN 'missing_on_po'
           WHEN i.mk IS NULL THEN 'missing_on_invoice'
           WHEN p.po_qty IS DISTINCT FROM i.inv_qty THEN 'quantity_mismatch'
           WHEN p.po_price IS DISTINCT FROM i.inv_price THEN 'price_mismatch'
           ELSE 'match'
         END AS flag_type
  FROM po p FULL OUTER JOIN inv i ON p.mk = i.mk
)
SELECT * FROM joined WHERE flag_type <> 'match'
`.trim()

interface ComparisonRow {
  po_line_item_id: string | null
  invoice_line_item_id: string | null
  sku: string | null
  po_qty: number | null
  inv_qty: number | null
  po_price: number | null
  inv_price: number | null
  flag_type: 'quantity_mismatch' | 'price_mismatch' | 'missing_on_invoice' | 'missing_on_po'
}

interface LineItemForCsv {
  id: string
  sku: string | null
  description: string | null
  quantity: string | null
  unitPrice: string | null
}

function serializeForCsv(item: LineItemForCsv) {
  return {
    id: item.id,
    sku: item.sku ?? '',
    description: item.description ?? '',
    quantity: item.quantity ?? '',
    unit_price: item.unitPrice ?? '',
  }
}

@Injectable()
export class ComparisonService {
  constructor(private readonly duckDb: DuckDbQueryService) {}

  async compare(workspaceId: string, purchaseOrderId: string, invoiceId: string) {
    const po = await this.loadReadyPo(workspaceId, purchaseOrderId)
    const invoice = await this.loadReadyInvoice(workspaceId, invoiceId)

    const poItems = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
    const invItems = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoice.id))

    if (poItems.length === 0 || invItems.length === 0) {
      throw new BadRequestException('Both documents must have parsed line items to compare')
    }

    const dir = await mkdtemp(join(tmpdir(), 'optra-cmp-'))
    const poCsvPath = join(dir, 'po.csv')
    const invCsvPath = join(dir, 'invoice.csv')

    try {
      await writeFile(poCsvPath, Papa.unparse(poItems.map(serializeForCsv)), 'utf-8')
      await writeFile(invCsvPath, Papa.unparse(invItems.map(serializeForCsv)), 'utf-8')

      const rows = (await this.duckDb.runReadOnlyMultiTableQuery(
        [
          { csvPath: poCsvPath, tableName: PO_TABLE },
          { csvPath: invCsvPath, tableName: INV_TABLE },
        ],
        COMPARISON_SQL,
      )) as unknown as ComparisonRow[]

      await db
        .delete(discrepancyFlags)
        .where(
          and(
            eq(discrepancyFlags.workspaceId, workspaceId),
            eq(discrepancyFlags.purchaseOrderId, po.id),
            eq(discrepancyFlags.invoiceId, invoice.id),
          ),
        )

      const inserted =
        rows.length > 0
          ? await db
              .insert(discrepancyFlags)
              .values(rows.map((row) => this.toFlagValues(workspaceId, po.id, invoice.id, row)))
              .returning()
          : []

      return {
        comparedAt: new Date().toISOString(),
        counts: this.countByType(inserted),
        flags: inserted,
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  async listFlags(
    workspaceId: string,
    filters: { purchaseOrderId?: string; invoiceId?: string; status?: 'open' | 'dismissed' },
  ) {
    const conditions = [eq(discrepancyFlags.workspaceId, workspaceId)]
    if (filters.purchaseOrderId) conditions.push(eq(discrepancyFlags.purchaseOrderId, filters.purchaseOrderId))
    if (filters.invoiceId) conditions.push(eq(discrepancyFlags.invoiceId, filters.invoiceId))
    if (filters.status) conditions.push(eq(discrepancyFlags.status, filters.status))

    return db
      .select()
      .from(discrepancyFlags)
      .where(and(...conditions))
      .orderBy(discrepancyFlags.createdAt)
  }

  async dismissFlag(workspaceId: string, flagId: string, userId: string) {
    const [flag] = await db.select().from(discrepancyFlags).where(eq(discrepancyFlags.id, flagId)).limit(1)

    if (!flag || flag.workspaceId !== workspaceId) {
      throw new NotFoundException('Discrepancy flag not found')
    }

    const [updated] = await db
      .update(discrepancyFlags)
      .set({ status: 'dismissed', dismissedAt: new Date(), dismissedBy: userId })
      .where(eq(discrepancyFlags.id, flagId))
      .returning()

    return updated
  }

  private async loadReadyPo(workspaceId: string, id: string) {
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1)
    if (!po || po.workspaceId !== workspaceId) {
      throw new NotFoundException('Purchase order not found')
    }
    if (po.status !== 'done') {
      throw new BadRequestException('Purchase order has not finished parsing yet')
    }
    return po
  }

  private async loadReadyInvoice(workspaceId: string, id: string) {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1)
    if (!invoice || invoice.workspaceId !== workspaceId) {
      throw new NotFoundException('Invoice not found')
    }
    if (invoice.status !== 'done') {
      throw new BadRequestException('Invoice has not finished parsing yet')
    }
    return invoice
  }

  private toFlagValues(workspaceId: string, purchaseOrderId: string, invoiceId: string, row: ComparisonRow) {
    const isQuantity = row.flag_type === 'quantity_mismatch'
    const isPrice = row.flag_type === 'price_mismatch'

    return {
      workspaceId,
      purchaseOrderId,
      invoiceId,
      poLineItemId: row.po_line_item_id,
      invoiceLineItemId: row.invoice_line_item_id,
      sku: row.sku,
      flagType: row.flag_type,
      poValue: isQuantity ? this.numToStr(row.po_qty) : isPrice ? this.numToStr(row.po_price) : null,
      invoiceValue: isQuantity ? this.numToStr(row.inv_qty) : isPrice ? this.numToStr(row.inv_price) : null,
      delta: isQuantity
        ? this.numToStr(this.diff(row.po_qty, row.inv_qty))
        : isPrice
          ? this.numToStr(this.diff(row.po_price, row.inv_price))
          : null,
      reason: this.buildReason(row),
    }
  }

  private diff(a: number | null, b: number | null): number | null {
    if (a === null || b === null) return null
    return Math.round((a - b) * 100) / 100
  }

  private numToStr(value: number | null): string | null {
    return value === null ? null : String(value)
  }

  private buildReason(row: ComparisonRow): string {
    const sku = row.sku ?? '(unknown)'
    switch (row.flag_type) {
      case 'missing_on_po':
        return `Item ${sku} appears on the invoice but not on the purchase order`
      case 'missing_on_invoice':
        return `Item ${sku} appears on the purchase order but not on the invoice`
      case 'quantity_mismatch':
        return `Quantity mismatch for ${sku}: PO=${row.po_qty ?? 'unknown'} Invoice=${row.inv_qty ?? 'unknown'}`
      case 'price_mismatch':
        return `Unit price mismatch for ${sku}: PO=${row.po_price ?? 'unknown'} Invoice=${row.inv_price ?? 'unknown'}`
    }
  }

  private countByType(flags: DiscrepancyFlag[]) {
    return {
      quantity_mismatch: flags.filter((flag) => flag.flagType === 'quantity_mismatch').length,
      price_mismatch: flags.filter((flag) => flag.flagType === 'price_mismatch').length,
      missing_on_invoice: flags.filter((flag) => flag.flagType === 'missing_on_invoice').length,
      missing_on_po: flags.filter((flag) => flag.flagType === 'missing_on_po').length,
    }
  }
}
