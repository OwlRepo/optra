import { randomUUID } from 'crypto'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
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
  type InvoiceLineItem,
  type PoLineItem,
} from '@repo/db'
import { DuckDbQueryService, SqlExecutionError } from '../structured-query/duckdb-query.service'

const PO_TABLE = 'po_items'
const INV_TABLE = 'inv_items'

// Fixed, hand-written template — never built from row data. Row values only
// ever enter via CSV loaded by DuckDbQueryService's trusted read_csv_auto
// BEFORE enable_external_access=false; this string is the entire "SQL
// surface" here and is still re-validated by assertReadOnlySelect() as
// defense-in-depth.
//
// The match key `mk` is computed in TypeScript (matchKey below), not in SQL.
// read_csv_auto infers each file's column types independently and reads an
// empty cell as NULL, so deriving the key in DuckDB made a blank-SKU,
// blank-description row key to NULL and mislabel as missing_on_po. A key that
// always carries a text prefix (`sku::`, `desc::`, `unkeyed::<id>`) is always
// VARCHAR, never NULL, and an unkeyed line can never join anything.
//
// Each side is grouped by key first, so duplicate lines for one item are
// summed instead of fanning out N×M through the join. Quantity/price
// aggregates stay NULL when any line in the group is unparseable, matching the
// old per-line IS DISTINCT FROM semantics. `total_rows` lets the caller prove
// the result was not truncated.
const COMPARISON_SQL = `
WITH po AS (
  SELECT mk,
         arg_min(id, line_number) AS po_line_item_id,
         COUNT(*) AS po_lines,
         CASE WHEN COUNT(*) = COUNT(TRY_CAST(quantity AS DOUBLE))
              THEN ROUND(SUM(TRY_CAST(quantity AS DOUBLE)), 6) END AS po_qty,
         CASE WHEN COUNT(*) = COUNT(TRY_CAST(unit_price AS DOUBLE))
              THEN MIN(TRY_CAST(unit_price AS DOUBLE)) END AS po_price_min,
         CASE WHEN COUNT(*) = COUNT(TRY_CAST(unit_price AS DOUBLE))
              THEN MAX(TRY_CAST(unit_price AS DOUBLE)) END AS po_price_max
  FROM ${PO_TABLE}
  GROUP BY mk
),
inv AS (
  SELECT mk,
         arg_min(id, line_number) AS invoice_line_item_id,
         COUNT(*) AS inv_lines,
         CASE WHEN COUNT(*) = COUNT(TRY_CAST(quantity AS DOUBLE))
              THEN ROUND(SUM(TRY_CAST(quantity AS DOUBLE)), 6) END AS inv_qty,
         CASE WHEN COUNT(*) = COUNT(TRY_CAST(unit_price AS DOUBLE))
              THEN MIN(TRY_CAST(unit_price AS DOUBLE)) END AS inv_price_min,
         CASE WHEN COUNT(*) = COUNT(TRY_CAST(unit_price AS DOUBLE))
              THEN MAX(TRY_CAST(unit_price AS DOUBLE)) END AS inv_price_max
  FROM ${INV_TABLE}
  GROUP BY mk
),
joined AS (
  SELECT p.po_line_item_id, i.invoice_line_item_id, p.po_lines, i.inv_lines,
         p.po_qty, i.inv_qty, p.po_price_min, p.po_price_max, i.inv_price_min, i.inv_price_max,
         CASE
           WHEN p.po_line_item_id IS NULL THEN 'missing_on_po'
           WHEN i.invoice_line_item_id IS NULL THEN 'missing_on_invoice'
           WHEN p.po_qty IS DISTINCT FROM i.inv_qty THEN 'quantity_mismatch'
           WHEN p.po_price_min IS DISTINCT FROM p.po_price_max
             OR i.inv_price_min IS DISTINCT FROM i.inv_price_max
             OR p.po_price_min IS DISTINCT FROM i.inv_price_min THEN 'price_mismatch'
           ELSE 'match'
         END AS flag_type
  FROM po p FULL OUTER JOIN inv i ON p.mk = i.mk
)
SELECT *, COUNT(*) OVER () AS total_rows FROM joined WHERE flag_type <> 'match'
`.trim()

type FlagType = 'quantity_mismatch' | 'price_mismatch' | 'missing_on_invoice' | 'missing_on_po'

interface ComparisonRow {
  po_line_item_id: string | null
  invoice_line_item_id: string | null
  po_lines: number | null
  inv_lines: number | null
  po_qty: number | null
  inv_qty: number | null
  po_price_min: number | null
  po_price_max: number | null
  inv_price_min: number | null
  inv_price_max: number | null
  flag_type: FlagType
  total_rows: number
}

interface ComparedLines {
  po: Map<string, PoLineItem>
  invoice: Map<string, InvoiceLineItem>
}

interface LineItemForCsv {
  id: string
  lineNumber: number
  sku: string | null
  description: string | null
  quantity: string | null
  unitPrice: string | null
}

// SKU primary, normalized description fallback, null when the line carries
// neither (it cannot be matched to anything).
function matchKey(item: { sku: string | null; description: string | null }): string | null {
  const sku = item.sku?.trim().toLowerCase()
  if (sku) return `sku::${sku}`
  const description = item.description?.trim().toLowerCase()
  if (description) return `desc::${description}`
  return null
}

function serializeForCsv(item: LineItemForCsv) {
  return {
    id: item.id,
    line_number: item.lineNumber,
    mk: matchKey(item) ?? `unkeyed::${item.id}`,
    quantity: item.quantity ?? '',
    unit_price: item.unitPrice ?? '',
  }
}

@Injectable()
export class ComparisonService {
  private readonly logger = new Logger(ComparisonService.name)

  constructor(private readonly duckDb: DuckDbQueryService) {}

  async compare(workspaceId: string, purchaseOrderId: string, invoiceId: string) {
    const po = await this.loadReadyPo(workspaceId, purchaseOrderId)
    const invoice = await this.loadReadyInvoice(workspaceId, invoiceId)

    // The parents are already workspace-checked; the children repeat the
    // predicate so a line row can never enter a comparison through a parent id
    // alone (defense in depth — the line tables carry their own workspace_id).
    const poItems = await db
      .select()
      .from(poLineItems)
      .where(and(eq(poLineItems.workspaceId, workspaceId), eq(poLineItems.purchaseOrderId, po.id)))
    const invItems = await db
      .select()
      .from(invoiceLineItems)
      .where(and(eq(invoiceLineItems.workspaceId, workspaceId), eq(invoiceLineItems.invoiceId, invoice.id)))

    if (poItems.length === 0 || invItems.length === 0) {
      throw new BadRequestException('Both documents must have parsed line items to compare')
    }

    const dir = await mkdtemp(join(tmpdir(), 'optra-cmp-'))
    const poCsvPath = join(dir, 'po.csv')
    const invCsvPath = join(dir, 'invoice.csv')

    try {
      await writeFile(poCsvPath, Papa.unparse(poItems.map(serializeForCsv)), 'utf-8')
      await writeFile(invCsvPath, Papa.unparse(invItems.map(serializeForCsv)), 'utf-8')

      // Every result row is one distinct key from one side or both, so the
      // result can never exceed the combined line count. Every row is persisted,
      // so the default 500-row cap would silently drop real discrepancies.
      const rows = (await this.duckDb.runReadOnlyMultiTableQuery(
        [
          { csvPath: poCsvPath, tableName: PO_TABLE },
          { csvPath: invCsvPath, tableName: INV_TABLE },
        ],
        COMPARISON_SQL,
        { maxRows: poItems.length + invItems.length },
      )) as unknown as ComparisonRow[]

      if (rows.length > 0 && rows[0].total_rows !== rows.length) {
        throw new SqlExecutionError(`Comparison result truncated: ${rows.length} of ${rows[0].total_rows} rows`)
      }

      const lines: ComparedLines = {
        po: new Map(poItems.map((item) => [item.id, item])),
        invoice: new Map(invItems.map((item) => [item.id, item])),
      }

      const inserted = await db.transaction(async (tx) => {
        // Row lock on the PO: concurrent compares touching this PO queue here,
        // so each delete+insert pair runs alone and a pair never ends up with
        // two flag sets. The transaction also means a failed insert leaves the
        // previous flag set in place instead of an empty one.
        await tx
          .select({ id: purchaseOrders.id })
          .from(purchaseOrders)
          .where(and(eq(purchaseOrders.id, po.id), eq(purchaseOrders.workspaceId, workspaceId)))
          .for('update')

        await tx
          .delete(discrepancyFlags)
          .where(
            and(
              eq(discrepancyFlags.workspaceId, workspaceId),
              eq(discrepancyFlags.purchaseOrderId, po.id),
              eq(discrepancyFlags.invoiceId, invoice.id),
            ),
          )

        return rows.length > 0
          ? tx
              .insert(discrepancyFlags)
              .values(rows.map((row) => this.toFlagValues(workspaceId, po.id, invoice.id, row, lines)))
              .returning()
          : []
      })

      return {
        comparedAt: new Date().toISOString(),
        counts: this.countByType(inserted),
        flags: inserted,
      }
    } catch (error) {
      // Ids and counts only. Engine and database messages can quote cell
      // values from the compared documents, so they never reach the client or
      // this log line; DuckDbQueryService and the global filter keep the full
      // detail server-side.
      const context =
        `workspace=${workspaceId} po=${po.id} invoice=${invoice.id} ` +
        `poItems=${poItems.length} invItems=${invItems.length}`

      if (error instanceof SqlExecutionError) {
        const reference = randomUUID().slice(0, 8)
        this.logger.error(`Comparison engine failed ref=${reference} ${context}`)
        throw new ServiceUnavailableException(`Comparison engine failed. Reference: ${reference}`)
      }

      this.logger.error(`Comparison failed ${context}: ${error instanceof Error ? error.name : 'unknown error'}`)
      throw error
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

  // Only an open flag in this workspace is updated. A repeat dismiss returns the
  // stored row untouched, so the first dismisser and time stay the audit record.
  async dismissFlag(workspaceId: string, flagId: string, userId: string) {
    const [updated] = await db
      .update(discrepancyFlags)
      .set({ status: 'dismissed', dismissedAt: new Date(), dismissedBy: userId })
      .where(
        and(
          eq(discrepancyFlags.id, flagId),
          eq(discrepancyFlags.workspaceId, workspaceId),
          eq(discrepancyFlags.status, 'open'),
        ),
      )
      .returning()

    if (updated) {
      return updated
    }

    const [existing] = await db
      .select()
      .from(discrepancyFlags)
      .where(and(eq(discrepancyFlags.id, flagId), eq(discrepancyFlags.workspaceId, workspaceId)))
      .limit(1)

    if (!existing) {
      throw new NotFoundException('Discrepancy flag not found')
    }
    return existing
  }

  private async loadReadyPo(workspaceId: string, id: string) {
    const [po] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.workspaceId, workspaceId)))
      .limit(1)
    if (!po) {
      throw new NotFoundException('Purchase order not found')
    }
    if (po.status !== 'done') {
      throw new BadRequestException('Purchase order has not finished parsing yet')
    }
    return po
  }

  private async loadReadyInvoice(workspaceId: string, id: string) {
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.workspaceId, workspaceId)))
      .limit(1)
    if (!invoice) {
      throw new NotFoundException('Invoice not found')
    }
    if (invoice.status !== 'done') {
      throw new BadRequestException('Invoice has not finished parsing yet')
    }
    return invoice
  }

  private toFlagValues(
    workspaceId: string,
    purchaseOrderId: string,
    invoiceId: string,
    row: ComparisonRow,
    lines: ComparedLines,
  ) {
    const poLine = row.po_line_item_id ? lines.po.get(row.po_line_item_id) : undefined
    const invoiceLine = row.invoice_line_item_id ? lines.invoice.get(row.invoice_line_item_id) : undefined
    const isQuantity = row.flag_type === 'quantity_mismatch'
    const isPrice = row.flag_type === 'price_mismatch'
    const poPrice = this.singlePrice(row.po_price_min, row.po_price_max)
    const invoicePrice = this.singlePrice(row.inv_price_min, row.inv_price_max)

    return {
      workspaceId,
      purchaseOrderId,
      invoiceId,
      poLineItemId: row.po_line_item_id,
      invoiceLineItemId: row.invoice_line_item_id,
      // The exact stored string, never DuckDB's re-typed copy of it.
      sku: poLine?.sku ?? invoiceLine?.sku ?? null,
      flagType: row.flag_type,
      poValue: isQuantity ? this.numToStr(row.po_qty) : isPrice ? this.numToStr(poPrice) : null,
      invoiceValue: isQuantity ? this.numToStr(row.inv_qty) : isPrice ? this.numToStr(invoicePrice) : null,
      delta: isQuantity
        ? this.numToStr(this.diff(row.po_qty, row.inv_qty))
        : isPrice
          ? this.numToStr(this.diff(poPrice, invoicePrice))
          : null,
      reason: this.buildReason(row, poLine, invoiceLine),
    }
  }

  // A side's unit price, or null when its duplicate lines disagree.
  private singlePrice(min: number | null, max: number | null): number | null {
    return min !== null && min === max ? min : null
  }

  private diff(a: number | null, b: number | null): number | null {
    if (a === null || b === null) return null
    return Math.round((a - b) * 100) / 100
  }

  private numToStr(value: number | null): string | null {
    return value === null ? null : String(value)
  }

  private buildReason(row: ComparisonRow, poLine?: PoLineItem, invoiceLine?: InvoiceLineItem): string {
    const sku = poLine?.sku ?? invoiceLine?.sku ?? '(unknown)'
    const summed = this.summedNote(row)

    switch (row.flag_type) {
      case 'missing_on_po':
        if (invoiceLine && matchKey(invoiceLine) === null) {
          return `Invoice line ${invoiceLine.lineNumber} has no SKU or description, so it cannot be matched to the purchase order`
        }
        return `Item ${sku} appears on the invoice but not on the purchase order${summed}`
      case 'missing_on_invoice':
        if (poLine && matchKey(poLine) === null) {
          return `Purchase order line ${poLine.lineNumber} has no SKU or description, so it cannot be matched to the invoice`
        }
        return `Item ${sku} appears on the purchase order but not on the invoice${summed}`
      case 'quantity_mismatch':
        return `Quantity mismatch for ${sku}: PO=${row.po_qty ?? 'unknown'} Invoice=${row.inv_qty ?? 'unknown'}${summed}`
      case 'price_mismatch': {
        const poMixed = row.po_price_min !== row.po_price_max
        const invoiceMixed = row.inv_price_min !== row.inv_price_max
        if (poMixed || invoiceMixed) {
          const sides = [
            poMixed ? `the purchase order (${row.po_price_min}–${row.po_price_max})` : null,
            invoiceMixed ? `the invoice (${row.inv_price_min}–${row.inv_price_max})` : null,
          ].filter(Boolean)
          return `Unit price mismatch for ${sku}: multiple unit prices on ${sides.join(' and ')}${summed}`
        }
        return `Unit price mismatch for ${sku}: PO=${row.po_price_min ?? 'unknown'} Invoice=${row.inv_price_min ?? 'unknown'}${summed}`
      }
    }
  }

  private summedNote(row: ComparisonRow): string {
    const parts: string[] = []
    if ((row.po_lines ?? 0) > 1) parts.push(`${row.po_lines} purchase order lines`)
    if ((row.inv_lines ?? 0) > 1) parts.push(`${row.inv_lines} invoice lines`)
    return parts.length > 0 ? ` (summed across ${parts.join(' and ')})` : ''
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
