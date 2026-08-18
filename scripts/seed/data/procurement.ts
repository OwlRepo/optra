// Procurement: three PO/invoice pairs with line items and the discrepancy
// flags a comparison run would have produced.
//
// Every numeric column (quantity, unitPrice, lineTotal, delta) is passed as a
// STRING — drizzle's `numeric` maps to a JS string, and handing it a number
// silently loses precision on the way in.
import { DEMO_WORKSPACE_ID, daysAgo } from '../config'

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

/** Which line-item template a pair uses, and which quarter it belongs to. */
const templateOf = (pair: number) => pair % TEMPLATES
const periodOf = (pair: number) => Math.floor(pair / TEMPLATES)
const QUARTERS = ['Q1', 'Q2', 'Q3']

interface LineSpec {
  sku: string
  description: string
  qty: string
  price: string
}

// Office / facilities purchasing for the demo agency.
const PO_LINES: LineSpec[][] = [
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
  { skip?: string[]; extra?: LineSpec[]; qty?: Record<string, string>; price?: Record<string, string> }
> = {
  0: {
    qty: { 'MON-2704': '20' },
    price: { 'CHR-2201': '338.00' },
    skip: ['MAT-0075'],
    extra: [{ sku: 'FEE-SHIP', description: 'Freight and handling surcharge', qty: '1', price: '285.00' }],
  },
  1: {
    price: { 'LAP-9001': '2610.00' },
    qty: { 'HDS-4400': '8' },
  },
  2: {
    qty: { 'COF-7700': '30' },
    skip: ['PLT-0012'],
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
  return PO_LINES[templateOf(pair)]!.map(line => ({
    ...line,
    qty: String(Math.max(1, Math.round(Number(line.qty) * scale))),
  }))
}

function invoiceLinesFor(poIndex: number): LineSpec[] {
  // Only the first quarter of each template carries deliberate discrepancies;
  // later quarters reconcile cleanly, which is what makes the flagged ones
  // stand out instead of everything looking broken.
  const mutation = periodOf(poIndex) === 0 ? (INVOICE_MUTATIONS[templateOf(poIndex)] ?? {}) : {}
  const lines = poLinesFor(poIndex)
    .filter(line => !mutation.skip?.includes(line.sku))
    .map(line => ({
      ...line,
      qty: mutation.qty?.[line.sku] ?? line.qty,
      price: mutation.price?.[line.sku] ?? line.price,
    }))
  return [...lines, ...(mutation.extra ?? [])]
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
    currency: 'USD',
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

export function poLineId(poIndex: number, n: number): string {
  return `12000000-0000-4000-8000-${String(poIndex * 100 + n).padStart(12, '0')}`
}

export function invoiceLineId(invoiceIndex: number, n: number): string {
  return `13000000-0000-4000-8000-${String(invoiceIndex * 100 + n).padStart(12, '0')}`
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
      createdAt: daysAgo(poAge(i) - 4),
    })),
  )
}

/** Locates a line by SKU so flags can reference real line-item ids. */
function findLine(lines: LineSpec[], sku: string): { line: LineSpec; index: number } | null {
  const index = lines.findIndex(l => l.sku === sku)
  return index === -1 ? null : { line: lines[index]!, index }
}

export function buildDiscrepancyFlagRows() {
  const rows: Record<string, unknown>[] = []

  const push = (
    poIndex: number,
    sku: string,
    flagType: 'quantity_mismatch' | 'price_mismatch' | 'missing_on_invoice' | 'missing_on_po',
    poValue: string | null,
    invoiceValue: string | null,
    delta: string | null,
    reason: string,
  ) => {
    const po = findLine(poLinesFor(poIndex), sku)
    const inv = findLine(invoiceLinesFor(poIndex), sku)
    rows.push({
      workspaceId: DEMO_WORKSPACE_ID,
      purchaseOrderId: PO_IDS[poIndex]!,
      invoiceId: INVOICE_IDS[poIndex]!,
      poLineItemId: po ? poLineId(poIndex, po.index + 1) : null,
      invoiceLineItemId: inv ? invoiceLineId(poIndex, inv.index + 1) : null,
      sku,
      flagType,
      poValue,
      invoiceValue,
      delta,
      reason,
      status: 'open' as const,
      dismissedAt: null,
      dismissedBy: null,
      createdAt: daysAgo(poAge(poIndex) - 6),
    })
  }

  push(0, 'MON-2704', 'quantity_mismatch', '18', '20', '2', 'Invoice bills 20 monitors against 18 ordered.')
  push(0, 'CHR-2201', 'price_mismatch', '312.50', '338.00', '25.50', 'Unit price is $25.50 above the agreed PO rate.')
  push(0, 'MAT-0075', 'missing_on_invoice', '12', null, '-12', 'Standing mats were ordered but do not appear on the invoice.')
  push(0, 'FEE-SHIP', 'missing_on_po', null, '1', '1', 'Freight surcharge of $285.00 was never quoted on the PO.')
  push(1, 'LAP-9001', 'price_mismatch', '2450.00', '2610.00', '160.00', 'Laptop unit price exceeds the PO rate by $160.00 per unit.')
  push(1, 'HDS-4400', 'quantity_mismatch', '10', '8', '-2', 'Two fewer headsets invoiced than ordered.')
  push(2, 'COF-7700', 'quantity_mismatch', '24', '30', '6', 'Six extra kilos of coffee invoiced against the PO.')
  push(2, 'PLT-0012', 'missing_on_invoice', '10', null, '-10', 'Office plants ordered but not invoiced; check whether they shipped.')

  return rows
}
