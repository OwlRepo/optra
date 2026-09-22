// Procurement: three PO/invoice pairs with line items and the discrepancy
// flags a comparison run would have produced.
//
// Every numeric column (quantity, unitPrice, lineTotal, delta) is passed as a
// STRING — drizzle's `numeric` maps to a JS string, and handing it a number
// silently loses precision on the way in.
import { DEMO_WORKSPACE_ID, daysAgo, VENDOR_IDS } from '../config'

// Three purchasing templates (furniture, IT hardware, consumables) ordered
// once per quarter — nine PO/invoice pairs in total. Repeat orders of the same
// catalogue against the same vendors is what real procurement looks like, and
// it gives the comparison view more than one period to reason about.
const TEMPLATES = 3
const PERIODS = 3
const PAIRS = TEMPLATES * PERIODS

export const PO_IDS = Array.from(
  { length: PAIRS },
  (_, i) => `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
)

export const INVOICE_IDS = Array.from(
  { length: PAIRS },
  (_, i) => `11000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
)

export const COMPARISON_RUN_IDS = Array.from(
  { length: PAIRS },
  (_, i) => `14000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
)

/**
 * One abandoned run, so the demo shows the shape S7's run history renders and
 * previously never displayed: a comparison that started and never closed, swept
 * into `failed` with a client-safe reference.
 *
 * It is the LATEST run for its pair and has no `initiatedBy`, which makes it an
 * automatic run — which is what lets the seeded `comparison_failed` event point
 * at something real. It does not disturb which flags are current: that keys on
 * the latest *succeeded* run.
 */
export const FAILED_COMPARISON_RUN_ID = '14000000-0000-4000-8000-000000000099'
const FAILED_COMPARISON_PAIR = PAIRS - 1

/** Which line-item template a pair uses, and which quarter it belongs to. */
const templateOf = (pair: number) => pair % TEMPLATES
const periodOf = (pair: number) => Math.floor(pair / TEMPLATES)
const QUARTERS = ['Q1', 'Q2', 'Q3']

interface LineSpec {
  sku: string
  description: string
  qty: string
  price: string
  // Set only where an invoice deliberately states a different unit from the PO
  // (S6). Everywhere else the unit comes from `provenanceFor`, so all three
  // documents agree and no unit flag is manufactured.
  uom?: string
}

// Office / facilities purchasing for the demo agency.
// Exported for the S9 price terms, which must agree with what these orders
// actually cost — a seeded contract price that disagreed with the seeded
// purchase order would manufacture an exception out of nothing.
export const PO_LINE_SPECS: LineSpec[][] = [
  [
    { sku: 'DSK-1042', description: 'Sit-stand desk, 160x80, oak', qty: '12', price: '489.00' },
    { sku: 'CHR-2201', description: 'Ergonomic task chair, mesh back', qty: '12', price: '312.50' },
    { sku: 'MON-2704', description: '27" 4K monitor, USB-C 90W', qty: '18', price: '429.00' },
    { sku: 'ARM-0110', description: 'Dual monitor arm, clamp mount', qty: '9', price: '118.75' },
    { sku: 'KBD-0450', description: 'Low-profile mechanical keyboard', qty: '18', price: '96.00' },
    { sku: 'MSE-0331', description: 'Vertical ergonomic mouse', qty: '18', price: '64.25' },
    { sku: 'HUB-1180', description: 'USB-C docking station, dual DP', qty: '18', price: '187.00' },
    { sku: 'LMP-0620', description: 'Desk lamp, adjustable colour temp', qty: '12', price: '54.90' },
    { sku: 'CBL-0090', description: 'USB-C cable 2m, 100W', qty: '40', price: '12.40' },
    { sku: 'MAT-0075', description: 'Anti-fatigue standing mat', qty: '12', price: '78.00' },
  ],
  [
    { sku: 'LAP-9001', description: 'Developer laptop, 32GB / 1TB', qty: '6', price: '2450.00' },
    { sku: 'DCK-9110', description: 'Thunderbolt dock, 4-port', qty: '6', price: '289.00' },
    { sku: 'HDS-4400', description: 'Noise-cancelling headset, USB', qty: '10', price: '215.00' },
    { sku: 'WEB-1200', description: '1080p conference webcam', qty: '4', price: '148.00' },
    { sku: 'SSD-2000', description: 'Portable NVMe SSD 2TB', qty: '8', price: '176.50' },
    { sku: 'BAG-0310', description: 'Padded laptop backpack', qty: '10', price: '89.00' },
    { sku: 'ADP-0210', description: '100W USB-C power adapter', qty: '10', price: '58.00' },
    { sku: 'LCK-0044', description: 'Laptop security lock', qty: '10', price: '31.25' },
  ],
  [
    { sku: 'PPR-0001', description: 'A4 copy paper, 80gsm, box of 5 reams', qty: '30', price: '24.60' },
    { sku: 'TNR-4420', description: 'Toner cartridge, black, high yield', qty: '8', price: '142.00' },
    { sku: 'WBM-0140', description: 'Whiteboard markers, assorted, box of 12', qty: '15', price: '11.80' },
    { sku: 'NTB-0220', description: 'Hardcover notebook, dotted, A5', qty: '40', price: '9.40' },
    { sku: 'COF-7700', description: 'Fair-trade coffee beans, 1kg', qty: '24', price: '21.90' },
    { sku: 'CUP-0031', description: 'Recyclable cups, sleeve of 50', qty: '20', price: '6.75' },
    { sku: 'CLN-0900', description: 'Surface cleaning wipes, tub of 200', qty: '18', price: '13.20' },
    { sku: 'BIN-0455', description: 'Recycling bin, 60L, three-stream', qty: '5', price: '96.00' },
    { sku: 'PLT-0012', description: 'Office plant, potted, medium', qty: '10', price: '38.00' },
  ],
]

// Invoices mostly mirror the PO. The deliberate deltas below are what the
// discrepancy flags describe.
const INVOICE_MUTATIONS: Record<
  number,
  {
    skip?: string[]
    extra?: LineSpec[]
    qty?: Record<string, string>
    price?: Record<string, string>
    uom?: Record<string, string>
    // S6 / POLICY v1 #6. A vendor billing in a different currency from the
    // order is not an arithmetic error, it is a question — so the demo carries
    // one, on a pair whose other flags are quantity-based and stay readable
    // whatever the money is denominated in.
    currency?: string
  }
> = {
  0: {
    qty: { 'MON-2704': '20' },
    price: { 'CHR-2201': '338.00' },
    // Ordered by the box, billed by the unit. Units are captured, never
    // converted (POLICY v1 #4), so this is a review, not a dispute.
    uom: { 'KBD-0450': 'each' },
    skip: ['MAT-0075'],
    extra: [{ sku: 'FEE-SHIP', description: 'Freight and handling surcharge', qty: '1', price: '285.00' }],
  },
  1: {
    price: { 'LAP-9001': '2610.00' },
    qty: { 'HDS-4400': '8', 'WEB-1200': '3' },
  },
  2: {
    qty: { 'COF-7700': '30' },
    skip: ['PLT-0012'],
    currency: 'EUR',
  },
}

function lineTotal(qty: string, price: string): string {
  return (Number(qty) * Number(price)).toFixed(2)
}

/**
 * Line items for a pair: the template's list with quantities scaled per
 * quarter, so repeat orders are not carbon copies of each other.
 */
function poLinesFor(pair: number): LineSpec[] {
  const period = periodOf(pair)
  const scale = [1, 0.6, 1.4][period] ?? 1
  // S9. Prices drift upward across quarters, so a vendor's price history has a
  // shape to read instead of three identical points.
  //
  // Period 0 is left EXACTLY as written, and that is load-bearing rather than
  // tidy: every INVOICE_MUTATIONS entry and every hand-written
  // `discrepancy_flags` row belongs to pairs 0-2, which are period 0. Moving a
  // price there would silently contradict a flag whose poValue/invoiceValue
  // were typed by hand — the defect S6 found when it first ran the real engine
  // over the demo data.
  //
  // It also means the seeded contract prices, authored at the period-0 price,
  // are honoured in period 0 and exceeded later: the demo shows a real
  // `contract_price_variance` without manufacturing a flood of them.
  const priceScale = [1, 1.04, 1.11][period] ?? 1
  return PO_LINE_SPECS[templateOf(pair)]!.map(line => ({
    ...line,
    qty: String(Math.max(1, Math.round(Number(line.qty) * scale))),
    price: priceScale === 1 ? line.price : (Number(line.price) * priceScale).toFixed(2),
  }))
}

function invoiceLinesFor(poIndex: number): LineSpec[] {
  // Only the first quarter of each template carries deliberate discrepancies;
  // later quarters reconcile cleanly, which is what makes the flagged ones
  // stand out instead of everything looking broken.
  const mutation = invoiceMutationFor(poIndex)
  const lines = poLinesFor(poIndex)
    .filter(line => !mutation.skip?.includes(line.sku))
    .map(line => ({
      ...line,
      qty: mutation.qty?.[line.sku] ?? line.qty,
      price: mutation.price?.[line.sku] ?? line.price,
      uom: mutation.uom?.[line.sku],
    }))
  return [...lines, ...(mutation.extra ?? [])]
}

// Only the first quarter of each template carries deliberate discrepancies —
// factored out because the invoice header (currency) needs the same rule as the
// lines, and two copies of it would drift.
function invoiceMutationFor(poIndex: number) {
  return periodOf(poIndex) === 0 ? (INVOICE_MUTATIONS[templateOf(poIndex)] ?? {}) : {}
}

const TEMPLATE_NAMES = ['Office fit-out', 'Engineering hardware refresh', 'Facilities consumables']

/** Older quarters sit further back in time so the list reads chronologically. */
const poAge = (pair: number) => 30 + periodOf(pair) * 60 - templateOf(pair) * 6

export function buildPurchaseOrderRows() {
  return PO_IDS.map((id, i) => ({
    id,
    workspaceId: DEMO_WORKSPACE_ID,
    name: `PO — ${TEMPLATE_NAMES[templateOf(i)]} ${QUARTERS[periodOf(i)]}`,
    poNumber: `PO-2026-${String(1180 + i)}`,
    currency: 'USD',
    // S3b. Before this the PO/vendor correspondence existed only as a matching
    // string in the invoice's `name`; now it is a real foreign key, and the
    // template index is what ties a PO to the vendor that supplies it.
    vendorId: VENDOR_IDS[templateOf(i)]!,
    storageKey: null,
    sourceKind: templateOf(i) === 1 ? 'pdf-extraction' : 'csv',
    status: 'done' as const,
    queueJobId: null,
    enqueuedAt: daysAgo(poAge(i)),
    processingStartedAt: daysAgo(poAge(i)),
    rowCount: poLinesFor(i).length,
    lastError: null,
    createdAt: daysAgo(poAge(i)),
    updatedAt: daysAgo(poAge(i) - 1),
  }))
}

const VENDOR_NAMES = ['Nordwerk Interiors', 'Brightline Systems', 'Cedar Supply Co']

export function buildInvoiceRows() {
  return INVOICE_IDS.map((id, i) => ({
    id,
    workspaceId: DEMO_WORKSPACE_ID,
    name: `INV — ${VENDOR_NAMES[templateOf(i)]} ${44120 + i * 137}`,
    invoiceNumber: `INV-${String(44120 + i * 137)}`,
    currency: invoiceMutationFor(i).currency ?? 'USD',
    // POLICY v1 #2: every invoice answers exactly one PO, chosen explicitly.
    // The seed pairs them by index, which is what the comparison runs assume.
    purchaseOrderId: PO_IDS[i]!,
    storageKey: null,
    sourceKind: templateOf(i) === 1 ? 'pdf-extraction' : 'csv',
    status: 'done' as const,
    queueJobId: null,
    enqueuedAt: daysAgo(poAge(i) - 4),
    processingStartedAt: daysAgo(poAge(i) - 4),
    rowCount: invoiceLinesFor(i).length,
    lastError: null,
    createdAt: daysAgo(poAge(i) - 4),
    updatedAt: daysAgo(poAge(i) - 5),
  }))
}

/**
 * Goods receipts (S5). Two per purchase order on the first template so POLICY
 * v1 #14's "sum accepted across every GRN linked to the PO" has something real
 * to sum in S6; one elsewhere.
 *
 * `14000000-…` is taken by comparison runs, so receipts start at `15000000-…`
 * and their lines at `16000000-…`.
 */
export const GRN_IDS = Array.from(
  { length: PAIRS + TEMPLATES },
  (_, i) => `15000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
)

// Receipt i belongs to PO (i % PAIRS): the extra TEMPLATES entries wrap around
// and give the first three purchase orders a second receipt each.
export const grnPoIndex = (grnIndex: number) => grnIndex % PAIRS

export function grnLineId(grnIndex: number, n: number): string {
  return `16000000-0000-4000-8000-${String(grnIndex * 100 + n).padStart(12, '0')}`
}

export function buildGoodsReceiptRows() {
  return GRN_IDS.map((id, i) => {
    const poIndex = grnPoIndex(i)
    return {
      id,
      workspaceId: DEMO_WORKSPACE_ID,
      purchaseOrderId: PO_IDS[poIndex]!,
      name: `GRN — ${TEMPLATE_NAMES[templateOf(poIndex)]} ${QUARTERS[periodOf(poIndex)]}${i >= PAIRS ? ' (second delivery)' : ''}`,
      grnNumber: `GRN-${String(70110 + i)}`,
      storageKey: null,
      // No PDF receipts: the extraction chain cannot express received vs
      // accepted, so S5 refuses them at upload.
      sourceKind: 'csv',
      status: 'done' as const,
      queueJobId: null,
      enqueuedAt: daysAgo(poAge(poIndex) - 2),
      processingStartedAt: daysAgo(poAge(poIndex) - 2),
      rowCount: grnLinesFor(i).length,
      lastError: null,
      createdAt: daysAgo(poAge(poIndex) - 2),
      updatedAt: daysAgo(poAge(poIndex) - 3),
    }
  })
}

/**
 * What actually turned up. Deliberately not a copy of the PO: receipt 0 is a
 * short delivery, receipt 1 has a rejected quantity, and receipt 2 leaves
 * `quantityAccepted` NULL — the "source did not say" case S6 must not read as
 * zero (§1B, POLICY v1 #14).
 */
// Items whose follow-up delivery never turned up, so the demo carries a real
// short receipt and a real over-billing rather than only receipts that
// reconcile. Both belong to template 1 and only its first quarter has a second
// delivery, so nothing else is affected.
const NEVER_REDELIVERED = new Set(['WEB-1200', 'SSD-2000'])

function grnLinesFor(grnIndex: number) {
  const poIndex = grnPoIndex(grnIndex)
  const isSecondDelivery = grnIndex >= PAIRS
  return poLinesFor(poIndex)
    // `n` stays the item's position on the PURCHASE ORDER, not in this
    // receipt: the rejection below is keyed on it, and letting the filter
    // renumber would move the rejection onto a different item.
    .map((line, n) => ({ line, n }))
    .filter(({ line }) => !(isSecondDelivery && NEVER_REDELIVERED.has(line.sku)))
    .map(({ line, n }) => {
      const ordered = Number(line.qty)
      // A second delivery carries the remainder, so the pair sums to the order.
      const received = isSecondDelivery
        ? Math.max(1, ordered - Math.round(ordered * 0.75))
        : Math.round(ordered * 0.75)
      // The rejected item is chosen by position so it lands on the same SKU in
      // both of that PO's receipts. Index 4 rather than 0 on purpose: line 0 of
      // this template already carries a price flag, and a rejection there would
      // outrank it and make the demo tell two stories about one item.
      const rejected = grnIndex % 3 === 1 && n === 4 ? 1 : 0
      const accepted = grnIndex % 3 === 2 ? null : String(Math.max(0, received - rejected))
      return {
        sku: line.sku,
        description: line.description,
        quantityReceived: String(received),
        quantityAccepted: accepted,
        quantityRejected: accepted === null ? null : String(rejected),
        // Keyed on the item's position on the PURCHASE ORDER, not in this
        // receipt. Deriving it from the receipt's own row number gave an item
        // one unit in the first delivery and another in the second whenever the
        // two receipts held different line counts — which S6 then correctly
        // reported as a unit mismatch against data that was simply wrong.
        uom: UOMS[n % UOMS.length]!,
      }
    })
}

export function buildGoodsReceiptLineItemRows() {
  return GRN_IDS.flatMap((grnId, grnIndex) =>
    grnLinesFor(grnIndex).map((line, n) => ({
      id: grnLineId(grnIndex, n + 1),
      workspaceId: DEMO_WORKSPACE_ID,
      goodsReceiptId: grnId,
      lineNumber: n + 1,
      sku: line.sku,
      description: line.description,
      quantityReceived: line.quantityReceived,
      quantityAccepted: line.quantityAccepted,
      quantityRejected: line.quantityRejected,
      uom: line.uom,
      rawRow: null,
      sourceSheet: null,
      sourceRow: n + 2,
      sourceKind: 'csv',
      createdAt: daysAgo(poAge(grnPoIndex(grnIndex)) - 2),
    })),
  )
}

export function poLineId(poIndex: number, n: number): string {
  return `12000000-0000-4000-8000-${String(poIndex * 100 + n).padStart(12, '0')}`
}

export function invoiceLineId(invoiceIndex: number, n: number): string {
  return `13000000-0000-4000-8000-${String(invoiceIndex * 100 + n).padStart(12, '0')}`
}

// Provenance mirrors what the parse worker would have written: a spreadsheet
// knows the row it came from, a PDF knows how sure the model was, and neither
// knows the other. Template 1 is the PDF-sourced one.
const isPdfTemplate = (index: number) => templateOf(index) === 1
const UOMS = ['each', 'box', 'set']
const provenanceFor = (index: number, n: number) =>
  isPdfTemplate(index)
    ? {
        uom: null,
        sourceRow: null,
        sourceSheet: null,
        extractionConfidence: (0.82 + ((n * 3) % 15) / 100).toFixed(2),
        extractorVersion: 'procurement-extraction@1',
      }
    : {
        uom: UOMS[n % UOMS.length]!,
        sourceRow: n + 2,
        sourceSheet: null,
        extractionConfidence: null,
        extractorVersion: null,
      }

export function buildPoLineItemRows() {
  return PO_IDS.flatMap((_, poIndex) =>
    poLinesFor(poIndex).map((line, n) => ({
      id: poLineId(poIndex, n + 1),
      workspaceId: DEMO_WORKSPACE_ID,
      purchaseOrderId: PO_IDS[poIndex]!,
      lineNumber: n + 1,
      sku: line.sku,
      description: line.description,
      quantity: line.qty,
      unitPrice: line.price,
      lineTotal: lineTotal(line.qty, line.price),
      rawRow: { sku: line.sku, description: line.description, qty: line.qty, unit_price: line.price },
      sourceKind: templateOf(poIndex) === 1 ? 'pdf-extraction' : 'csv',
      ...provenanceFor(poIndex, n),
      createdAt: daysAgo(poAge(poIndex)),
    })),
  )
}

export function buildInvoiceLineItemRows() {
  return INVOICE_IDS.flatMap((invoiceId, i) =>
    invoiceLinesFor(i).map((line, n) => ({
      id: invoiceLineId(i, n + 1),
      workspaceId: DEMO_WORKSPACE_ID,
      invoiceId,
      lineNumber: n + 1,
      sku: line.sku,
      description: line.description,
      quantity: line.qty,
      unitPrice: line.price,
      lineTotal: lineTotal(line.qty, line.price),
      rawRow: { sku: line.sku, description: line.description, qty: line.qty, unit_price: line.price },
      sourceKind: templateOf(i) === 1 ? 'pdf-extraction' : 'csv',
      ...provenanceFor(i, n),
      // After the spread, so a deliberate invoice unit overrides the shared one.
      ...(line.uom ? { uom: line.uom } : {}),
      createdAt: daysAgo(poAge(i) - 4),
    })),
  )
}

/**
 * The receipt line a receiving flag points at: the earliest delivery that
 * mentions the item, mirroring the engine's `arg_min(id, line_number)`.
 */
function goodsReceiptLineIdFor(poIndex: number, sku: string): string | null {
  for (const grnIndex of grnIndexesForPo(poIndex)) {
    const position = grnLinesFor(grnIndex).findIndex(line => line.sku === sku)
    if (position !== -1) return grnLineId(grnIndex, position + 1)
  }
  return null
}

/** Locates a line by SKU so flags can reference real line-item ids. */
function findLine(lines: LineSpec[], sku: string): { line: LineSpec; index: number } | null {
  const index = lines.findIndex(l => l.sku === sku)
  return index === -1 ? null : { line: lines[index]!, index }
}

// One succeeded run per pair, so the demo shows the same provenance a real
// comparison writes: every flag belongs to a run, and the run records what it
// read. Without these the seeded flags would be treated as pre-S1 legacy rows.
//
// Plus one abandoned run (see FAILED_COMPARISON_RUN_ID) — runs are append-only,
// so more than one per pair is the real shape, not an anomaly.
export function buildComparisonRunRows() {
  const runs: {
    id: string
    workspaceId: string
    purchaseOrderId: string
    invoiceId: string
    mode: string
    strategyVersion: number
    status: 'succeeded' | 'failed'
    initiatedBy: string | null
    poLineCount: number
    invoiceLineCount: number
    goodsReceiptLineCount: number
    flagCount: number | null
    startedAt: Date
    finishedAt: Date
    lastError: string | null
    createdAt: Date
  }[] = COMPARISON_RUN_IDS.map((id, i) => ({
    id,
    workspaceId: DEMO_WORKSPACE_ID,
    purchaseOrderId: PO_IDS[i]!,
    invoiceId: INVOICE_IDS[i]!,
    // Every seeded PO has at least one receipt, so every run is three-way.
    // POLICY v1 #14 makes this derived, not chosen: two_way means "no receiving
    // evidence existed", and claiming it here would be false.
    mode: 'three_way',
    strategyVersion: 1,
    status: 'succeeded' as const,
    initiatedBy: null,
    poLineCount: poLinesFor(i).length,
    invoiceLineCount: invoiceLinesFor(i).length,
    goodsReceiptLineCount: grnIndexesForPo(i).reduce((total, grnIndex) => total + grnLinesFor(grnIndex).length, 0),
    flagCount: flagCountFor(i),
    startedAt: daysAgo(poAge(i) - 6),
    finishedAt: daysAgo(poAge(i) - 6),
    lastError: null,
    createdAt: daysAgo(poAge(i) - 6),
  }))

  const pair = FAILED_COMPARISON_PAIR
  runs.push({
    id: FAILED_COMPARISON_RUN_ID,
    workspaceId: DEMO_WORKSPACE_ID,
    purchaseOrderId: PO_IDS[pair]!,
    invoiceId: INVOICE_IDS[pair]!,
    // The mode is decided when the run row is written, before the engine runs,
    // so an abandoned run still carries one.
    mode: 'three_way',
    strategyVersion: 1,
    status: 'failed' as const,
    initiatedBy: null,
    poLineCount: poLinesFor(pair).length,
    invoiceLineCount: invoiceLinesFor(pair).length,
    goodsReceiptLineCount: grnIndexesForPo(pair).reduce(
      (total, grnIndex) => total + grnLinesFor(grnIndex).length,
      0,
    ),
    // Null, not zero: nothing ever counted. Only the success path writes it,
    // and zero would claim the run looked and found nothing.
    flagCount: null,
    startedAt: daysAgo(3),
    finishedAt: daysAgo(3),
    lastError: 'Comparison did not finish. Reference: 4f2a9c17',
    createdAt: daysAgo(3),
  })

  return runs
}

/** Which receipts belong to a purchase order — the inverse of `grnPoIndex`. */
function grnIndexesForPo(poIndex: number): number[] {
  return GRN_IDS.map((_, grnIndex) => grnIndex).filter(grnIndex => grnPoIndex(grnIndex) === poIndex)
}

/**
 * Which receipts each run actually read (§1E "source document IDs"). Recorded
 * rather than re-derived, so a receipt uploaded later cannot change what an
 * earlier run says it compared — and so POLICY v1 #9's retention guard has rows
 * to find when it refuses to delete evidence.
 */
export function buildComparisonRunGoodsReceiptRows() {
  return COMPARISON_RUN_IDS.flatMap((comparisonRunId, poIndex) =>
    // Two columns only — the table is a composite key and carries no
    // timestamp of its own; the run it points at already has one.
    grnIndexesForPo(poIndex).map(grnIndex => ({
      comparisonRunId,
      goodsReceiptId: GRN_IDS[grnIndex]!,
    })),
  )
}

/** How many flags `buildDiscrepancyFlagRows` emits for a pair. */
function flagCountFor(poIndex: number): number {
  return buildDiscrepancyFlagRows().filter(row => row.purchaseOrderId === PO_IDS[poIndex]).length
}

export function buildDiscrepancyFlagRows() {
  const rows: Record<string, unknown>[] = []

  const push = (
    poIndex: number,
    sku: string,
    flagType:
      | 'quantity_mismatch'
      | 'price_mismatch'
      | 'missing_on_invoice'
      | 'missing_on_po'
      | 'short_receipt'
      | 'invoice_exceeds_received'
      | 'uom_mismatch',
    poValue: string | null,
    invoiceValue: string | null,
    delta: string | null,
    reason: string,
    // What was accepted, between ordered and billed. Filled on the receiving
    // and unit types; null on the four that never read a receipt.
    receivedValue: string | null = null,
  ) => {
    const po = findLine(poLinesFor(poIndex), sku)
    const inv = findLine(invoiceLinesFor(poIndex), sku)
    rows.push({
      workspaceId: DEMO_WORKSPACE_ID,
      purchaseOrderId: PO_IDS[poIndex]!,
      invoiceId: INVOICE_IDS[poIndex]!,
      comparisonRunId: COMPARISON_RUN_IDS[poIndex]!,
      poLineItemId: po ? poLineId(poIndex, po.index + 1) : null,
      invoiceLineItemId: inv ? invoiceLineId(poIndex, inv.index + 1) : null,
      goodsReceiptLineItemId: receivedValue === null ? null : goodsReceiptLineIdFor(poIndex, sku),
      sku,
      flagType,
      poValue,
      receivedValue,
      invoiceValue,
      delta,
      reason,
      status: 'open' as const,
      dismissedAt: null,
      dismissedBy: null,
      createdAt: daysAgo(poAge(poIndex) - 6),
    })
  }

  // POLICY v1 #6. Header-level, so it belongs to the run rather than to a line:
  // no SKU, no line references, and no delta — the amounts are not comparable
  // at all, which is a different statement from "they differ by N".
  const pushCurrencyMismatch = (poIndex: number, poCurrency: string, invoiceCurrency: string) => {
    rows.push({
      workspaceId: DEMO_WORKSPACE_ID,
      purchaseOrderId: PO_IDS[poIndex]!,
      invoiceId: INVOICE_IDS[poIndex]!,
      comparisonRunId: COMPARISON_RUN_IDS[poIndex]!,
      poLineItemId: null,
      invoiceLineItemId: null,
      goodsReceiptLineItemId: null,
      sku: null,
      flagType: 'currency_mismatch' as const,
      poValue: poCurrency,
      receivedValue: null,
      invoiceValue: invoiceCurrency,
      delta: null,
      reason:
        `Currency mismatch: the purchase order is in ${poCurrency} but the invoice is in ${invoiceCurrency}. ` +
        'Amounts are not comparable and no conversion is applied, so this needs review',
      status: 'open' as const,
      dismissedAt: null,
      dismissedBy: null,
      createdAt: daysAgo(poAge(poIndex) - 6),
    })
  }

  // Pair 0 — everything arrived, so the exceptions are about what was billed.
  push(
    0,
    'MON-2704',
    'invoice_exceeds_received',
    '18',
    '20',
    '2',
    'Invoice bills 20 monitors, but only 18 were received and accepted.',
    '18',
  )
  push(0, 'CHR-2201', 'price_mismatch', '312.50', '338.00', '25.50', 'Unit price is $25.50 above the agreed PO rate.')
  push(0, 'MAT-0075', 'missing_on_invoice', '12', null, '-12', 'Standing mats were ordered but do not appear on the invoice.')
  push(0, 'FEE-SHIP', 'missing_on_po', null, '1', '1', 'Freight surcharge of $285.00 was never quoted on the PO.')
  push(
    0,
    'KBD-0450',
    'uom_mismatch',
    'box',
    'each',
    null,
    'Keyboards were ordered by the box and billed by the unit. Units are captured, never converted, so no quantity difference is reported.',
    'box',
  )
  // Pair 1 — a follow-up delivery that never came, plus a rejected item.
  push(1, 'LAP-9001', 'price_mismatch', '2450.00', '2610.00', '160.00', 'Laptop unit price exceeds the PO rate by $160.00 per unit.')
  push(1, 'HDS-4400', 'quantity_mismatch', '10', '8', '-2', 'Two fewer headsets invoiced than ordered.')
  push(
    1,
    'WEB-1200',
    'short_receipt',
    '4',
    '3',
    '-1',
    'Three of four webcams arrived; the balance was never redelivered.',
    '3',
  )
  push(
    1,
    'SSD-2000',
    'invoice_exceeds_received',
    '8',
    '8',
    '3',
    'All eight drives were invoiced, but one was rejected on arrival and two never shipped.',
    '5',
  )
  // Pair 2 — the receipts never stated an accepted quantity, so nothing about
  // receiving can be concluded and only the PO/invoice difference is reported.
  push(2, 'COF-7700', 'quantity_mismatch', '24', '30', '6', 'Six extra kilos of coffee invoiced against the PO.')
  push(2, 'PLT-0012', 'missing_on_invoice', '10', null, '-10', 'Office plants ordered but not invoiced; check whether they shipped.')
  pushCurrencyMismatch(2, 'USD', 'EUR')

  return rows
}
