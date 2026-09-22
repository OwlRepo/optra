export interface MappedLineItem {
  sku: string | null
  description: string | null
  quantity: string | null
  unitPrice: string | null
  lineTotal: string | null
  // Captured, never converted (POLICY v1 #4). A mismatch between two compared
  // lines becomes `needs_review` in S6; nothing normalizes or converts it here.
  uom: string | null
  // Goods receipt only (S5). Null on a purchase order or invoice row, which
  // have no such columns — and null on a receipt whose source did not state
  // the value. Null is NOT zero: POLICY v1 #14 and §1B both require that
  // missing receiving data is never read as "nothing was accepted".
  //
  // Optional, not just nullable: a purchase-order or invoice caller builds this
  // literal without them, exactly as it already may for `uom`. Absent and null
  // mean the same thing here — "the source did not say".
  quantityReceived?: string | null
  quantityAccepted?: string | null
  quantityRejected?: string | null
}

const SKU_ALIASES = ['sku', 'item', 'item code', 'itemcode', 'product code', 'productcode']
const DESCRIPTION_ALIASES = ['description', 'desc', 'item name', 'itemname', 'name']
const QUANTITY_ALIASES = ['qty', 'quantity', 'units']
const UNIT_PRICE_ALIASES = ['unit price', 'unitprice', 'price', 'unit cost', 'unitcost', 'rate']
const LINE_TOTAL_ALIASES = ['total', 'line total', 'linetotal', 'amount']
// Deliberately excludes 'unit' and 'units': 'units' is already a QUANTITY
// alias, and a vendor's "Units" column means how many, not what kind. Stealing
// it for UOM would silently corrupt every quantity on that document, so only
// unambiguous headers are listed here.
const UOM_ALIASES = ['uom', 'u/m', 'u.o.m.', 'unit of measure', 'units of measure', 'measure']
// Goods receipt columns (S5). Matching is exact equality, so every spelling a
// receipt might use has to be listed — before this, a column headed
// "Qty Received" resolved to nothing and the whole document parsed empty.
//
// 'damaged' is deliberately NOT a rejected alias: damage and rejection are not
// the same event, and POLICY v1 has not declared that mapping (hard stop #1).
// 'received'/'accepted'/'rejected' bare words are included — no other alias
// list claims them, so there is nothing for them to steal.
const QUANTITY_RECEIVED_ALIASES = [
  'qty received',
  'received qty',
  'received quantity',
  'quantity received',
  'qty rcvd',
  'received',
]
const QUANTITY_ACCEPTED_ALIASES = [
  'qty accepted',
  'accepted qty',
  'accepted quantity',
  'quantity accepted',
  'accepted',
]
const QUANTITY_REJECTED_ALIASES = [
  'qty rejected',
  'rejected qty',
  'rejected quantity',
  'quantity rejected',
  'rejected',
]

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase()
}

// Vendor files spell the same column differently ("SKU" vs "Item Code"),
// so each field is resolved from a fixed alias list rather than a single
// expected header name. First alias match wins; unmatched/blank cells fall
// through as null rather than throwing — a partially-mapped row is still
// useful once paired with the raw row a caller keeps for audit (see
// procurement-parse.processor.ts).
function findValue(row: Record<string, string>, aliases: string[]): string | null {
  const normalizedEntries = Object.entries(row).map(
    ([key, value]) => [normalizeHeader(key), value] as const,
  )

  for (const alias of aliases) {
    const match = normalizedEntries.find(([key]) => key === alias)
    if (match && match[1] !== undefined && match[1].trim() !== '') {
      return match[1].trim()
    }
  }

  return null
}

// po_line_items.sku / invoice_line_items.sku are varchar(200).
export const MAX_SKU_LENGTH = 200
// po_line_items.uom / invoice_line_items.uom are varchar(20).
const MAX_UOM_LENGTH = 20

// Plain decimal, optional sign/exponent — the forms Postgres `numeric` reads
// as the number a person means. Thousands separators, currency symbols, words
// and hex are rejected rather than guessed at.
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

function numericOrNull(value: string | null): string | null {
  return value !== null && DECIMAL_PATTERN.test(value) ? value : null
}

/**
 * What `validateLineItem` guarantees: the receipt quantities are optional on the
 * way IN (a purchase-order caller builds a literal without them) but always
 * present on the way OUT, so a consumer spreading the result gets a complete
 * row rather than three possibly-undefined fields.
 */
export type ValidatedLineItem = Omit<
  MappedLineItem,
  'quantityReceived' | 'quantityAccepted' | 'quantityRejected'
> & {
  quantityReceived: string | null
  quantityAccepted: string | null
  quantityRejected: string | null
}

// One bad cell must not fail a whole document: a value the column cannot hold
// becomes null (the caller keeps the original in rawRow, and comparison flags
// the unknown value) instead of aborting the bulk insert for every row.
export function validateLineItem(item: MappedLineItem): ValidatedLineItem {
  return {
    sku: item.sku !== null && item.sku.length <= MAX_SKU_LENGTH ? item.sku : null,
    description: item.description,
    quantity: numericOrNull(item.quantity),
    unitPrice: numericOrNull(item.unitPrice),
    lineTotal: numericOrNull(item.lineTotal),
    // Nullish rather than !== null: callers (and older fixtures) may omit the
    // field entirely, and an absent uom means the same as an empty one.
    uom: item.uom && item.uom.length <= MAX_UOM_LENGTH ? item.uom : null,
    // Nullish-safe for the same reason as uom: callers and older fixtures build
    // MappedLineItem literals without these fields.
    quantityReceived: numericOrNull(item.quantityReceived ?? null),
    quantityAccepted: numericOrNull(item.quantityAccepted ?? null),
    quantityRejected: numericOrNull(item.quantityRejected ?? null),
  }
}

/**
 * What a goods-receipt line actually says arrived.
 *
 * A receipt whose only quantity column is a plain "Qty" still means received,
 * so the generic column is the fallback — but an explicit received column wins,
 * because alias lookup is first-match-wins and 'qty' would otherwise take a row
 * that carries both.
 */
export function receivedQuantity(item: MappedLineItem): string | null {
  return item.quantityReceived ?? item.quantity
}

// A row describing nothing is dropped before insert. The receipt quantities
// count here: a receipt line that states only "8 received" is a real line, and
// leaving them out of this check filtered every such row out silently.
export function isEmptyLineItem(item: MappedLineItem): boolean {
  return (
    item.sku === null &&
    item.description === null &&
    item.quantity === null &&
    item.unitPrice === null &&
    item.lineTotal === null &&
    (item.quantityReceived ?? null) === null &&
    (item.quantityAccepted ?? null) === null &&
    (item.quantityRejected ?? null) === null
  )
}

export function mapRowToLineItem(row: Record<string, string>): MappedLineItem {
  return {
    sku: findValue(row, SKU_ALIASES),
    description: findValue(row, DESCRIPTION_ALIASES),
    quantity: findValue(row, QUANTITY_ALIASES),
    unitPrice: findValue(row, UNIT_PRICE_ALIASES),
    lineTotal: findValue(row, LINE_TOTAL_ALIASES),
    uom: findValue(row, UOM_ALIASES),
    quantityReceived: findValue(row, QUANTITY_RECEIVED_ALIASES),
    quantityAccepted: findValue(row, QUANTITY_ACCEPTED_ALIASES),
    quantityRejected: findValue(row, QUANTITY_REJECTED_ALIASES),
  }
}
