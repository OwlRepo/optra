export interface MappedLineItem {
  sku: string | null
  description: string | null
  quantity: string | null
  unitPrice: string | null
  lineTotal: string | null
}

const SKU_ALIASES = ['sku', 'item', 'item code', 'itemcode', 'product code', 'productcode']
const DESCRIPTION_ALIASES = ['description', 'desc', 'item name', 'itemname', 'name']
const QUANTITY_ALIASES = ['qty', 'quantity', 'units']
const UNIT_PRICE_ALIASES = ['unit price', 'unitprice', 'price', 'unit cost', 'unitcost', 'rate']
const LINE_TOTAL_ALIASES = ['total', 'line total', 'linetotal', 'amount']

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

// Plain decimal, optional sign/exponent — the forms Postgres `numeric` reads
// as the number a person means. Thousands separators, currency symbols, words
// and hex are rejected rather than guessed at.
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

function numericOrNull(value: string | null): string | null {
  return value !== null && DECIMAL_PATTERN.test(value) ? value : null
}

// One bad cell must not fail a whole document: a value the column cannot hold
// becomes null (the caller keeps the original in rawRow, and comparison flags
// the unknown value) instead of aborting the bulk insert for every row.
export function validateLineItem(item: MappedLineItem): MappedLineItem {
  return {
    sku: item.sku !== null && item.sku.length <= MAX_SKU_LENGTH ? item.sku : null,
    description: item.description,
    quantity: numericOrNull(item.quantity),
    unitPrice: numericOrNull(item.unitPrice),
    lineTotal: numericOrNull(item.lineTotal),
  }
}

export function isEmptyLineItem(item: MappedLineItem): boolean {
  return (
    item.sku === null &&
    item.description === null &&
    item.quantity === null &&
    item.unitPrice === null &&
    item.lineTotal === null
  )
}

export function mapRowToLineItem(row: Record<string, string>): MappedLineItem {
  return {
    sku: findValue(row, SKU_ALIASES),
    description: findValue(row, DESCRIPTION_ALIASES),
    quantity: findValue(row, QUANTITY_ALIASES),
    unitPrice: findValue(row, UNIT_PRICE_ALIASES),
    lineTotal: findValue(row, LINE_TOTAL_ALIASES),
  }
}
