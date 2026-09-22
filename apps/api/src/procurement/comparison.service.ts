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
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import Papa from 'papaparse'
import {
  comparisonRunGoodsReceipts,
  comparisonRuns,
  db,
  discrepancyDecisions,
  discrepancyFlags,
  workspaceMembers,
  goodsReceiptLineItems,
  goodsReceipts,
  invoiceLineItems,
  invoices,
  poLineItems,
  purchaseOrders,
  type DiscrepancyFlag,
  type GoodsReceiptLineItem,
  type InvoiceLineItem,
  type PoLineItem,
} from '@repo/db'
import { DuckDbQueryService, SqlExecutionError } from '../structured-query/duckdb-query.service'

type DecisionOutcome = (typeof discrepancyDecisions.$inferInsert)['outcome']

const DISMISS_SYSTEM_NOTE = 'Dismissed from the discrepancies list without a note.'

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

function pairKey(purchaseOrderId: string, invoiceId: string): string {
  return `${purchaseOrderId}:${invoiceId}`
}

const PO_TABLE = 'po_items'
const INV_TABLE = 'inv_items'
// Must satisfy assertSafeIdentifier (/^[a-zA-Z_][a-zA-Z0-9_]*$/) and must not
// contain a FORBIDDEN_KEYWORDS word — 'set', 'call', 'load' and 'create' are
// matched on word boundaries by assertReadOnlySelect.
const GRN_TABLE = 'grn_items'
// Must match serializeGoodsReceiptForCsv's keys exactly: it is what the empty
// case writes, and the `grn` CTE binds these column names.
const GRN_CSV_HEADER = 'id,line_number,mk,quantity_accepted,uom'

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
//
// S6 adds the receiving side. Two properties are load-bearing:
//
// 1. `grn_accepted_qty` uses the SAME guard as the quantity aggregates above,
//    and that is the whole point. A bare SUM() would silently skip NULLs and
//    return a PARTIAL total, so a receipt that never stated an accepted
//    quantity would look like a short delivery and Optra would accuse a
//    supplier who did nothing wrong. The guard yields NULL instead, and every
//    branch below tests `IS NOT NULL` before using it (POLICY v1 #14, §1B).
//
// 2. A line can be short-received AND over-billed at once (ordered 10,
//    accepted 7, billed 10). A CASE returns only its first match, so the order
//    here picks which LABEL that line gets — money first, because "billed for
//    more than we kept" is the actionable one. No information is lost by that
//    choice: the flag row carries po/received/invoice values together, so the
//    reviewer sees all three numbers whichever label won.
//
// With no receipts linked, the `grn` CTE is empty, every `g.*` is NULL, both
// new branches fall through, and the classification is byte-identical to the
// two-way behaviour that shipped in S1.
//
// S6 commit 2 adds the unit of measure. Three things about it are deliberate:
//
// 1. It is compared, never converted (POLICY v1 #4), and the branch sits ABOVE
//    every numeric branch. Ten boxes against twelve each is not a shortfall of
//    two; reporting one would be a number nobody can act on.
// 2. A side is also checked against ITSELF. Each CTE sums duplicate lines for
//    one item, and adding two boxes to one each produces "3" of nothing — so
//    `*_uom_count > 1` is the same defect as two sides disagreeing.
// 3. An unstated unit is not a different unit. Most rows in the system carry no
//    unit at all (`uom` arrived in S3a and only a source with a unit column
//    fills it), so every comparison below requires BOTH sides to have said
//    something — the same "absent is never a value" rule the accepted-quantity
//    guard above exists to enforce.
//
// `CAST(uom AS VARCHAR)` is not decoration: read_csv_auto infers each file's
// column types independently, and a file whose uom column is entirely empty can
// be typed as something other than VARCHAR, which would then be compared
// against another file's real text column.
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
              THEN MAX(TRY_CAST(unit_price AS DOUBLE)) END AS po_price_max,
         COUNT(DISTINCT CAST(uom AS VARCHAR)) AS po_uom_count,
         CASE WHEN COUNT(DISTINCT CAST(uom AS VARCHAR)) = 1
              THEN MIN(CAST(uom AS VARCHAR)) END AS po_uom
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
              THEN MAX(TRY_CAST(unit_price AS DOUBLE)) END AS inv_price_max,
         COUNT(DISTINCT CAST(uom AS VARCHAR)) AS inv_uom_count,
         CASE WHEN COUNT(DISTINCT CAST(uom AS VARCHAR)) = 1
              THEN MIN(CAST(uom AS VARCHAR)) END AS inv_uom
  FROM ${INV_TABLE}
  GROUP BY mk
),
grn AS (
  SELECT mk,
         arg_min(id, line_number) AS goods_receipt_line_item_id,
         COUNT(*) AS grn_lines,
         CASE WHEN COUNT(*) = COUNT(TRY_CAST(quantity_accepted AS DOUBLE))
              THEN ROUND(SUM(TRY_CAST(quantity_accepted AS DOUBLE)), 6) END AS grn_accepted_qty,
         COUNT(DISTINCT CAST(uom AS VARCHAR)) AS grn_uom_count,
         CASE WHEN COUNT(DISTINCT CAST(uom AS VARCHAR)) = 1
              THEN MIN(CAST(uom AS VARCHAR)) END AS grn_uom
  FROM ${GRN_TABLE}
  GROUP BY mk
),
joined AS (
  SELECT p.po_line_item_id, i.invoice_line_item_id, g.goods_receipt_line_item_id,
         p.po_lines, i.inv_lines, g.grn_lines,
         p.po_qty, i.inv_qty, g.grn_accepted_qty,
         p.po_price_min, p.po_price_max, i.inv_price_min, i.inv_price_max,
         p.po_uom, i.inv_uom, g.grn_uom,
         p.po_uom_count, i.inv_uom_count, g.grn_uom_count,
         CASE
           WHEN p.po_line_item_id IS NULL THEN 'missing_on_po'
           WHEN i.invoice_line_item_id IS NULL THEN 'missing_on_invoice'
           WHEN COALESCE(p.po_uom_count, 0) > 1
             OR COALESCE(i.inv_uom_count, 0) > 1
             OR COALESCE(g.grn_uom_count, 0) > 1
             OR (p.po_uom IS NOT NULL AND i.inv_uom IS NOT NULL AND p.po_uom <> i.inv_uom)
             OR (p.po_uom IS NOT NULL AND g.grn_uom IS NOT NULL AND p.po_uom <> g.grn_uom)
             OR (i.inv_uom IS NOT NULL AND g.grn_uom IS NOT NULL AND i.inv_uom <> g.grn_uom)
             THEN 'uom_mismatch'
           WHEN g.grn_accepted_qty IS NOT NULL AND i.inv_qty > g.grn_accepted_qty
             THEN 'invoice_exceeds_received'
           WHEN g.grn_accepted_qty IS NOT NULL AND g.grn_accepted_qty < p.po_qty
             THEN 'short_receipt'
           WHEN p.po_qty IS DISTINCT FROM i.inv_qty THEN 'quantity_mismatch'
           WHEN p.po_price_min IS DISTINCT FROM p.po_price_max
             OR i.inv_price_min IS DISTINCT FROM i.inv_price_max
             OR p.po_price_min IS DISTINCT FROM i.inv_price_min THEN 'price_mismatch'
           ELSE 'match'
         END AS flag_type
  FROM po p
  FULL OUTER JOIN inv i ON p.mk = i.mk
  FULL OUTER JOIN grn g ON COALESCE(p.mk, i.mk) = g.mk
)
SELECT *, COUNT(*) OVER () AS total_rows FROM joined WHERE flag_type <> 'match'
`.trim()

// Exactly what the CASE above can return — deliberately NOT every value of
// `discrepancy_flag_type`. `currency_mismatch` is a property of the two document
// headers, not of any matched line, so it never comes out of the engine and
// buildReason's switch stays exhaustive over the rows it really receives.
type FlagType =
  | 'quantity_mismatch'
  | 'price_mismatch'
  | 'missing_on_invoice'
  | 'missing_on_po'
  | 'short_receipt'
  | 'invoice_exceeds_received'
  | 'uom_mismatch'

interface ComparisonRow {
  po_line_item_id: string | null
  invoice_line_item_id: string | null
  goods_receipt_line_item_id: string | null
  po_lines: number | null
  inv_lines: number | null
  grn_lines: number | null
  po_qty: number | null
  inv_qty: number | null
  // Accepted quantity, summed across every receipt this run read. NULL when no
  // receipt exists for the key OR when any contributing line left it unstated —
  // never 0 for "unknown" (POLICY v1 #14).
  grn_accepted_qty: number | null
  po_price_min: number | null
  po_price_max: number | null
  inv_price_min: number | null
  inv_price_max: number | null
  // Normalized (trimmed, lower-cased) by serializeForCsv, so 'EA' and ' ea '
  // are one unit. NULL when the side stated none, and also when the side's own
  // lines stated more than one — in which case the matching *_uom_count is the
  // value that says so.
  po_uom: string | null
  inv_uom: string | null
  grn_uom: string | null
  po_uom_count: number | null
  inv_uom_count: number | null
  grn_uom_count: number | null
  flag_type: FlagType
  total_rows: number
}

interface ComparedLines {
  po: Map<string, PoLineItem>
  invoice: Map<string, InvoiceLineItem>
  goodsReceipt: Map<string, GoodsReceiptLineItem>
}

interface LineItemForCsv {
  id: string
  lineNumber: number
  sku: string | null
  description: string | null
  quantity: string | null
  unitPrice: string | null
  uom: string | null
}

// A receipt line has no price and three quantities rather than one, so it gets
// its own CSV shape instead of being forced into LineItemForCsv.
interface GoodsReceiptLineForCsv {
  id: string
  lineNumber: number | null
  sku: string | null
  description: string | null
  quantityAccepted: string | null
  uom: string | null
}

// 'EA', 'ea' and ' Each ' from three different source files are the same unit,
// and flagging them as a mismatch would be noise, not evidence. An empty result
// is written as an empty cell, which read_csv_auto reads back as NULL — the
// "not stated" case, which is never compared against anything.
function normalizeUom(uom: string | null): string {
  return uom?.trim().toLowerCase() ?? ''
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

// Mirrors serializeForCsv: same `mk` derivation so the three sides join on the
// same key, minus price, plus the one quantity the comparison consumes. An
// unstated accepted quantity stays empty, which read_csv_auto reads as NULL and
// the CTE's guard then propagates as NULL rather than zero.
function serializeGoodsReceiptForCsv(item: GoodsReceiptLineForCsv) {
  return {
    id: item.id,
    line_number: item.lineNumber ?? 0,
    mk: matchKey(item) ?? `unkeyed::${item.id}`,
    quantity_accepted: item.quantityAccepted ?? '',
    uom: normalizeUom(item.uom),
  }
}

function serializeForCsv(item: LineItemForCsv) {
  return {
    id: item.id,
    line_number: item.lineNumber,
    mk: matchKey(item) ?? `unkeyed::${item.id}`,
    quantity: item.quantity ?? '',
    unit_price: item.unitPrice ?? '',
    uom: normalizeUom(item.uom),
  }
}

@Injectable()
export class ComparisonService {
  private readonly logger = new Logger(ComparisonService.name)

  constructor(private readonly duckDb: DuckDbQueryService) {}

  async compare(workspaceId: string, purchaseOrderId: string, invoiceId: string, initiatedBy?: string) {
    const po = await this.loadReadyPo(workspaceId, purchaseOrderId)
    const invoice = await this.loadReadyInvoice(workspaceId, invoiceId)

    // S3b / POLICY v1 #2. The invoice records which PO it answers, chosen
    // explicitly at upload. Comparing it against a different PO would produce
    // evidence that silently contradicts that link, so refuse.
    //
    // A NULL link is the legacy path — every invoice uploaded before migration
    // 0025 has one, and those keep comparing freely. That is what lets this
    // ship additively, with no backfill.
    if (invoice.purchaseOrderId !== null && invoice.purchaseOrderId !== po.id) {
      throw new BadRequestException('Invoice is linked to a different purchase order')
    }

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

    // S6 / POLICY v1 #14: accepted quantity is summed across EVERY receipt
    // linked to this PO, so all of them are read, not one. Workspace-scoped on
    // both the header and the line rows, same defense in depth as above.
    const receipts = await db
      .select({ id: goodsReceipts.id })
      .from(goodsReceipts)
      .where(and(eq(goodsReceipts.workspaceId, workspaceId), eq(goodsReceipts.purchaseOrderId, po.id)))
    const receiptIds = receipts.map((receipt) => receipt.id)
    const grnItems = receiptIds.length
      ? await db
          .select()
          .from(goodsReceiptLineItems)
          .where(
            and(
              eq(goodsReceiptLineItems.workspaceId, workspaceId),
              inArray(goodsReceiptLineItems.goodsReceiptId, receiptIds),
            ),
          )
      : []

    // Three-way only when there is receiving evidence to compare against.
    // POLICY v1 #14: with no linked GRN the run stays two_way, and §7.4 says a
    // missing receiving document must be "clearly labeled; no false three-way
    // claim". A receipt that exists but parsed to zero lines is no evidence.
    const mode = grnItems.length > 0 ? 'three_way' : 'two_way'

    // The run row is written before the engine call so a failed attempt still
    // leaves evidence that someone tried, and when. A request that never gets
    // this far (unknown document, nothing parsed) records no run at all.
    const [run] = await db
      .insert(comparisonRuns)
      .values({
        workspaceId,
        purchaseOrderId: po.id,
        invoiceId: invoice.id,
        initiatedBy: initiatedBy ?? null,
        mode,
        poLineCount: poItems.length,
        invoiceLineCount: invItems.length,
        goodsReceiptLineCount: mode === 'three_way' ? grnItems.length : null,
      })
      .returning()

    const dir = await mkdtemp(join(tmpdir(), 'optra-cmp-'))
    const poCsvPath = join(dir, 'po.csv')
    const invCsvPath = join(dir, 'invoice.csv')
    const grnCsvPath = join(dir, 'grn.csv')

    try {
      await writeFile(poCsvPath, Papa.unparse(poItems.map(serializeForCsv)), 'utf-8')
      await writeFile(invCsvPath, Papa.unparse(invItems.map(serializeForCsv)), 'utf-8')
      // Always written, even when empty: the SQL names ${GRN_TABLE}
      // unconditionally, and a header-only CSV gives an empty CTE whose NULLs
      // make the two new branches fall through to the original two-way
      // classification.
      //
      // The header is written explicitly rather than left to Papa.unparse([]),
      // which emits an empty string. read_csv_auto then builds a table with no
      // columns at all and the `grn` CTE fails to bind `mk` — which broke every
      // two-way comparison, not just three-way ones, because this file is
      // loaded on every run.
      await writeFile(
        grnCsvPath,
        grnItems.length > 0
          ? Papa.unparse(grnItems.map(serializeGoodsReceiptForCsv))
          : GRN_CSV_HEADER,
        'utf-8',
      )

      // Every result row is one distinct key from one side or both, so the
      // result can never exceed the combined line count. Every row is persisted,
      // so the default 500-row cap would silently drop real discrepancies.
      const rows = (await this.duckDb.runReadOnlyMultiTableQuery(
        [
          { csvPath: poCsvPath, tableName: PO_TABLE },
          { csvPath: invCsvPath, tableName: INV_TABLE },
          { csvPath: grnCsvPath, tableName: GRN_TABLE },
        ],
        COMPARISON_SQL,
        // Still one row per distinct key, so the bound is the combined line
        // count of all three sides. Leaving the receipt side out of this sum
        // would make the total_rows assertion below fire on a correct result.
        { maxRows: poItems.length + invItems.length + grnItems.length },
      )) as unknown as ComparisonRow[]

      if (rows.length > 0 && rows[0].total_rows !== rows.length) {
        throw new SqlExecutionError(`Comparison result truncated: ${rows.length} of ${rows[0].total_rows} rows`)
      }

      const lines: ComparedLines = {
        po: new Map(poItems.map((item) => [item.id, item])),
        invoice: new Map(invItems.map((item) => [item.id, item])),
        goodsReceipt: new Map(grnItems.map((item) => [item.id, item])),
      }

      // Header-level, so it is decided outside the engine and outside the row
      // loop — see currencyMismatchFlag.
      const currencyFlag = this.currencyMismatchFlag(workspaceId, po, invoice)

      const inserted = await db.transaction(async (tx) => {
        // Row lock on the PO: concurrent compares touching this PO queue here.
        // Nothing is deleted any more, so this no longer protects a delete —
        // it orders the runs, which is what makes "the latest succeeded run"
        // unambiguous instead of a race on created_at.
        await tx
          .select({ id: purchaseOrders.id })
          .from(purchaseOrders)
          .where(and(eq(purchaseOrders.id, po.id), eq(purchaseOrders.workspaceId, workspaceId)))
          .for('update')

        // The header-level currency flag is written first so it leads the list:
        // it is the one that tells a reviewer why the money columns below it
        // cannot be read at face value.
        const flagValues = [
          ...(currencyFlag ? [currencyFlag] : []),
          ...rows.map((row) => this.toFlagValues(workspaceId, po.id, invoice.id, row, lines)),
        ]

        // No delete. A re-compare appends a new run; the previous run's flags
        // stay, and with them every dismissal a human recorded against them.
        const flags =
          flagValues.length > 0
            ? await tx
                .insert(discrepancyFlags)
                .values(flagValues.map((value) => ({ ...value, comparisonRunId: run.id })))
                .returning()
            : []

        // Which receipts this run actually read, recorded rather than re-derived
        // (§1E "source document IDs"). A receipt uploaded tomorrow must not
        // change what this run says it compared — and POLICY v1 #9's retention
        // guard reads these rows to know a receipt is now evidence.
        if (mode === 'three_way') {
          await tx
            .insert(comparisonRunGoodsReceipts)
            .values(receiptIds.map((goodsReceiptId) => ({ comparisonRunId: run.id, goodsReceiptId })))
        }

        await tx
          .update(comparisonRuns)
          .set({ status: 'succeeded', flagCount: flags.length, finishedAt: new Date() })
          .where(eq(comparisonRuns.id, run.id))

        return flags
      })

      return {
        runId: run.id,
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
        // The run keeps the same client-safe reference the caller was given,
        // so a failed attempt can be traced to this log line without the
        // engine's text — which can quote cell values — ever being stored.
        await this.failRun(run.id, `Comparison engine failed. Reference: ${reference}`)
        this.logger.error(`Comparison engine failed ref=${reference} ${context}`)
        throw new ServiceUnavailableException(`Comparison engine failed. Reference: ${reference}`)
      }

      const reference = randomUUID().slice(0, 8)
      await this.failRun(run.id, `Comparison failed. Reference: ${reference}`)
      this.logger.error(
        `Comparison failed ref=${reference} ${context}: ${error instanceof Error ? error.name : 'unknown error'}`,
      )
      throw error
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /**
   * Defaults to the *current* flags: those written by the latest succeeded run
   * for each PO/invoice pair. Without that, every re-compare would add another
   * copy of the same mismatch to the list. Flags with no run predate S1; they
   * count as current for their pair until that pair is compared again, so
   * nothing vanished from the UI when runs shipped.
   *
   * Pass `runId` to read one specific run, which is how history is reached.
   */
  async listFlags(
    workspaceId: string,
    filters: { purchaseOrderId?: string; invoiceId?: string; status?: 'open' | 'dismissed'; runId?: string },
  ) {
    const conditions = [eq(discrepancyFlags.workspaceId, workspaceId)]
    if (filters.purchaseOrderId) conditions.push(eq(discrepancyFlags.purchaseOrderId, filters.purchaseOrderId))
    if (filters.invoiceId) conditions.push(eq(discrepancyFlags.invoiceId, filters.invoiceId))
    if (filters.status) conditions.push(eq(discrepancyFlags.status, filters.status))

    if (filters.runId) {
      conditions.push(eq(discrepancyFlags.comparisonRunId, filters.runId))
      return db
        .select()
        .from(discrepancyFlags)
        .where(and(...conditions))
        .orderBy(discrepancyFlags.createdAt)
    }

    const currentRunByPair = await this.currentRunIdByPair(workspaceId)
    const currentRunIds = [...currentRunByPair.values()]

    // Narrow in SQL to current-run and legacy rows, so history does not have to
    // be read to be discarded; the remaining decision — whether a legacy row's
    // pair has since been compared — is settled from the same small map.
    const runScope = currentRunIds.length
      ? or(inArray(discrepancyFlags.comparisonRunId, currentRunIds), isNull(discrepancyFlags.comparisonRunId))
      : isNull(discrepancyFlags.comparisonRunId)
    if (runScope) conditions.push(runScope)

    const rows = await db
      .select()
      .from(discrepancyFlags)
      .where(and(...conditions))
      .orderBy(discrepancyFlags.createdAt)

    return rows.filter(
      (row) => row.comparisonRunId !== null || !currentRunByPair.has(pairKey(row.purchaseOrderId, row.invoiceId)),
    )
  }

  // Latest succeeded run per PO/invoice pair. Ordered newest-first, so the
  // first id seen for a pair is the one that wins.
  private async currentRunIdByPair(workspaceId: string): Promise<Map<string, string>> {
    const runs = await db
      .select({
        id: comparisonRuns.id,
        purchaseOrderId: comparisonRuns.purchaseOrderId,
        invoiceId: comparisonRuns.invoiceId,
      })
      .from(comparisonRuns)
      .where(and(eq(comparisonRuns.workspaceId, workspaceId), eq(comparisonRuns.status, 'succeeded')))
      .orderBy(desc(comparisonRuns.createdAt))

    const latest = new Map<string, string>()
    for (const run of runs) {
      const key = pairKey(run.purchaseOrderId, run.invoiceId)
      if (!latest.has(key)) latest.set(key, run.id)
    }
    return latest
  }

  private async failRun(runId: string, lastError: string) {
    await db
      .update(comparisonRuns)
      .set({ status: 'failed', lastError, finishedAt: new Date() })
      .where(eq(comparisonRuns.id, runId))
  }

  // Only an open flag in this workspace is updated. A repeat dismiss returns the
  // stored row untouched, so the first dismisser and time stay the audit record
  // — and, since S2, so that a second dismiss does not append a second decision.
  //
  // The route takes no body and the web client calls it that way, so POLICY v1
  // #7's required note is supplied by the system here; an explicit decision
  // through `recordDecision` demands a real one.
  async dismissFlag(workspaceId: string, flagId: string, userId: string) {
    const updated = await db.transaction(async (tx) => {
      const [flag] = await tx
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

      if (!flag) return null

      await tx.insert(discrepancyDecisions).values({
        workspaceId,
        discrepancyFlagId: flag.id,
        comparisonRunId: flag.comparisonRunId,
        actorUserId: userId,
        actorRole: await this.actorRole(tx, workspaceId, userId),
        outcome: 'false_positive',
        note: DISMISS_SYSTEM_NOTE,
      })

      return flag
    })

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

  /**
   * Append-only. A decision is never updated or deleted — a wrong call is
   * corrected by recording another one, so the trail stays readable. Every
   * outcome closes the flag: a human has adjudicated it, and which way they
   * went is `outcome`, not `status`.
   */
  async recordDecision(
    workspaceId: string,
    flagId: string,
    userId: string,
    input: { outcome: DecisionOutcome; note: string },
  ) {
    const note = input.note?.trim() ?? ''
    if (!note) {
      throw new BadRequestException('A decision note is required')
    }

    const [flag] = await db
      .select()
      .from(discrepancyFlags)
      .where(and(eq(discrepancyFlags.id, flagId), eq(discrepancyFlags.workspaceId, workspaceId)))
      .limit(1)

    if (!flag) {
      throw new NotFoundException('Discrepancy flag not found')
    }

    return db.transaction(async (tx) => {
      const [decision] = await tx
        .insert(discrepancyDecisions)
        .values({
          workspaceId,
          discrepancyFlagId: flag.id,
          comparisonRunId: flag.comparisonRunId,
          actorUserId: userId,
          actorRole: await this.actorRole(tx, workspaceId, userId),
          outcome: input.outcome,
          note,
        })
        .returning()

      await tx
        .update(discrepancyFlags)
        .set({ status: 'dismissed', dismissedAt: new Date(), dismissedBy: userId })
        .where(and(eq(discrepancyFlags.id, flag.id), eq(discrepancyFlags.status, 'open')))

      return decision
    })
  }

  async listDecisions(workspaceId: string, flagId: string) {
    return db
      .select()
      .from(discrepancyDecisions)
      .where(
        and(eq(discrepancyDecisions.workspaceId, workspaceId), eq(discrepancyDecisions.discrepancyFlagId, flagId)),
      )
      .orderBy(discrepancyDecisions.createdAt)
  }

  // The reviewer's role at the moment they decided, captured rather than
  // looked up later: memberships change, and the record should not.
  private async actorRole(tx: DbTx, workspaceId: string, userId: string): Promise<string> {
    const [membership] = await tx
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1)

    return membership?.role ?? 'unknown'
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
    const goodsReceiptLine = row.goods_receipt_line_item_id
      ? lines.goodsReceipt.get(row.goods_receipt_line_item_id)
      : undefined
    const isUom = row.flag_type === 'uom_mismatch'
    const isQuantity = row.flag_type === 'quantity_mismatch'
    const isPrice = row.flag_type === 'price_mismatch'
    const isMissingOnInvoice = row.flag_type === 'missing_on_invoice'
    const isMissingOnPo = row.flag_type === 'missing_on_po'
    const isShortReceipt = row.flag_type === 'short_receipt'
    const isInvoiceExceedsReceived = row.flag_type === 'invoice_exceeds_received'
    const poPrice = this.singlePrice(row.po_price_min, row.po_price_max)
    const invoicePrice = this.singlePrice(row.inv_price_min, row.inv_price_max)

    return {
      workspaceId,
      purchaseOrderId,
      invoiceId,
      poLineItemId: row.po_line_item_id,
      invoiceLineItemId: row.invoice_line_item_id,
      goodsReceiptLineItemId: row.goods_receipt_line_item_id,
      // The exact stored string, never DuckDB's re-typed copy of it.
      sku: poLine?.sku ?? invoiceLine?.sku ?? null,
      flagType: row.flag_type,
      // delta is invoice minus PO, so a positive number always means the
      // invoice asks for more than was ordered — what a reviewer scans for.
      // On a missing-side flag the absent side counts as zero and the present
      // side's value is kept, so the row renders as evidence instead of three
      // blank columns.
      // On a receiving flag all three numbers are filled, whichever label the
      // CASE chose: a line that is both short-received and over-billed shows
      // ordered, received and billed together, so nothing is hidden by the
      // branch order that picked between them.
      // On a UOM flag the disputed value IS the unit, so the three value
      // columns carry the units rather than quantities — each one the exact
      // string its own document stored, not the lower-cased copy the engine
      // compared, same rule as `sku` above.
      poValue:
        isQuantity || isMissingOnInvoice || isShortReceipt || isInvoiceExceedsReceived
          ? this.numToStr(row.po_qty)
          : isPrice
            ? this.numToStr(poPrice)
            : isUom
              ? (poLine?.uom ?? null)
              : null,
      receivedValue: isShortReceipt || isInvoiceExceedsReceived
        ? this.numToStr(row.grn_accepted_qty)
        : isUom
          ? (goodsReceiptLine?.uom ?? null)
          : null,
      invoiceValue:
        isQuantity || isMissingOnPo || isShortReceipt || isInvoiceExceedsReceived
          ? this.numToStr(row.inv_qty)
          : isPrice
            ? this.numToStr(invoicePrice)
            : isUom
              ? (invoiceLine?.uom ?? null)
              : null,
      // The S1 convention is unchanged for the four original types: delta is
      // invoice minus PO, so positive always means "asks for more than ordered".
      // The two receiving types keep the same reading direction against the
      // number they dispute — short_receipt is received minus ordered (negative
      // = short), invoice_exceeds_received is billed minus received (positive =
      // billed for more than we kept).
      //
      // uom_mismatch falls through to null on purpose: POLICY v1 #4 says no
      // delta is computed. Ten boxes against ten each is not a difference of
      // zero, and writing 0 here would read as "agreed".
      delta: isQuantity
        ? this.numToStr(this.diff(row.inv_qty, row.po_qty))
        : isPrice
          ? this.numToStr(this.diff(invoicePrice, poPrice))
          : isMissingOnInvoice
            ? this.numToStr(this.diff(0, row.po_qty))
            : isMissingOnPo
              ? this.numToStr(this.diff(row.inv_qty, 0))
              : isShortReceipt
                ? this.numToStr(this.diff(row.grn_accepted_qty, row.po_qty))
                : isInvoiceExceedsReceived
                  ? this.numToStr(this.diff(row.inv_qty, row.grn_accepted_qty))
                  : null,
      reason: this.buildReason(row, poLine, invoiceLine),
    }
  }

  /**
   * POLICY v1 #6. The only flag in the system that is not derived from a
   * matched line: a currency disagreement belongs to the two document headers,
   * so it is computed here in TypeScript rather than in the engine, and written
   * once per run with no line references and no delta.
   *
   * Both codes must be stated to disagree — an unstated currency is the legacy
   * shape of every pre-0025 document, and reading it as a mismatch would put
   * that whole population into review. Compared case-folded because S3b only
   * started uppercasing at the API boundary; rows written before it cannot be
   * fixed by validation.
   *
   * The line-level flags are NOT suppressed when this fires. A quantity
   * disagreement is true whatever the documents are billed in, and dropping
   * that evidence to avoid a confusing price column would hide more than it
   * explains.
   */
  private currencyMismatchFlag(
    workspaceId: string,
    po: { id: string; currency: string | null },
    invoice: { id: string; currency: string | null },
  ) {
    const poCurrency = po.currency?.trim().toUpperCase()
    const invoiceCurrency = invoice.currency?.trim().toUpperCase()
    if (!poCurrency || !invoiceCurrency || poCurrency === invoiceCurrency) return null

    return {
      workspaceId,
      purchaseOrderId: po.id,
      invoiceId: invoice.id,
      poLineItemId: null,
      invoiceLineItemId: null,
      goodsReceiptLineItemId: null,
      sku: null,
      flagType: 'currency_mismatch' as const,
      poValue: po.currency,
      receivedValue: null,
      invoiceValue: invoice.currency,
      delta: null,
      reason:
        `Currency mismatch: the purchase order is in ${poCurrency} but the invoice is in ${invoiceCurrency}. ` +
        'Amounts are not comparable and no conversion is applied, so this needs review',
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
      case 'short_receipt':
        return `Short receipt for ${sku}: ordered ${row.po_qty ?? 'unknown'}, accepted ${row.grn_accepted_qty ?? 'unknown'}${summed}`
      case 'invoice_exceeds_received':
        return `Invoice bills more than was accepted for ${sku}: accepted ${row.grn_accepted_qty ?? 'unknown'}, invoiced ${row.inv_qty ?? 'unknown'}${summed}`
      case 'uom_mismatch': {
        // Two different faults share this type, and the reviewer needs to know
        // which: one document contradicting itself is fixed at the source,
        // while two documents disagreeing is a conversation with the vendor.
        const selfContradicting = [
          (row.po_uom_count ?? 0) > 1 ? 'the purchase order' : null,
          (row.inv_uom_count ?? 0) > 1 ? 'the invoice' : null,
          (row.grn_uom_count ?? 0) > 1 ? 'the goods receipt' : null,
        ].filter(Boolean)
        if (selfContradicting.length > 0) {
          return `Unit of measure mismatch for ${sku}: ${selfContradicting.join(' and ')} lists more than one unit for this item, so its quantities cannot be added together`
        }
        const stated = [
          row.po_uom ? `PO=${row.po_uom}` : null,
          row.grn_uom ? `Received=${row.grn_uom}` : null,
          row.inv_uom ? `Invoice=${row.inv_uom}` : null,
        ].filter(Boolean)
        return `Unit of measure mismatch for ${sku}: ${stated.join(' ')}. Units are captured, never converted, so no quantity difference is reported${summed}`
      }
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
      default:
        // Not decoration. apps/api runs with strictNullChecks:false, so an
        // unhandled case here would fall through returning `undefined` and TS
        // would accept it against the declared `string` — the flag would then
        // fail on insert against a NOT NULL column, far from the cause.
        throw new Error(`Unhandled comparison flag type: ${String(row.flag_type)}`)
    }
  }

  private summedNote(row: ComparisonRow): string {
    const parts: string[] = []
    if ((row.po_lines ?? 0) > 1) parts.push(`${row.po_lines} purchase order lines`)
    if ((row.inv_lines ?? 0) > 1) parts.push(`${row.inv_lines} invoice lines`)
    if ((row.grn_lines ?? 0) > 1) parts.push(`${row.grn_lines} goods receipt lines`)
    return parts.length > 0 ? ` (summed across ${parts.join(' and ')})` : ''
  }

  private countByType(flags: DiscrepancyFlag[]) {
    return {
      quantity_mismatch: flags.filter((flag) => flag.flagType === 'quantity_mismatch').length,
      price_mismatch: flags.filter((flag) => flag.flagType === 'price_mismatch').length,
      missing_on_invoice: flags.filter((flag) => flag.flagType === 'missing_on_invoice').length,
      missing_on_po: flags.filter((flag) => flag.flagType === 'missing_on_po').length,
      short_receipt: flags.filter((flag) => flag.flagType === 'short_receipt').length,
      invoice_exceeds_received: flags.filter((flag) => flag.flagType === 'invoice_exceeds_received').length,
      uom_mismatch: flags.filter((flag) => flag.flagType === 'uom_mismatch').length,
      currency_mismatch: flags.filter((flag) => flag.flagType === 'currency_mismatch').length,
    }
  }
}
