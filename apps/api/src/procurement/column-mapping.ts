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

export function mapRowToLineItem(row: Record<string, string>): MappedLineItem {
  return {
    sku: findValue(row, SKU_ALIASES),
    description: findValue(row, DESCRIPTION_ALIASES),
    quantity: findValue(row, QUANTITY_ALIASES),
    unitPrice: findValue(row, UNIT_PRICE_ALIASES),
    lineTotal: findValue(row, LINE_TOTAL_ALIASES),
  }
}
