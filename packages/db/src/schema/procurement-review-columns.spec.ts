import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { goodsReceiptLineItems } from './goodsReceiptLineItems'
import { goodsReceipts } from './goodsReceipts'
import { invoiceLineItems } from './invoiceLineItems'
import { invoices } from './invoices'
import { poLineItems } from './poLineItems'
import { purchaseOrders } from './purchaseOrders'

const headers = { purchaseOrders, invoices, goodsReceipts }
const lines = { poLineItems, invoiceLineItems, goodsReceiptLineItems }

describe('procurement review + photo columns (migration 0036)', () => {
  it.each(Object.entries(headers))('error: %s.review_required is NOT NULL with default false', (_n, table) => {
    const col = getTableColumns(table).reviewRequired
    expect(col, 'reviewRequired missing').toBeDefined()
    expect(col.name).toBe('review_required')
    expect(col.notNull).toBe(true)
    expect(col.hasDefault).toBe(true)
    expect(col.default).toBe(false)
  })

  it.each(Object.entries(headers))('edge: %s reviewedAt/reviewedBy/detectedKind/pageCount are nullable', (_n, table) => {
    const cols = getTableColumns(table)
    for (const key of ['reviewedAt', 'reviewedBy', 'detectedKind', 'pageCount'] as const) {
      expect(cols[key], `${key} missing`).toBeDefined()
      expect(cols[key].notNull).toBe(false)
    }
  })

  it.each(Object.entries(lines))('edge: %s editedAt/editedBy/extractedValues are nullable', (_n, table) => {
    const cols = getTableColumns(table)
    for (const key of ['editedAt', 'editedBy', 'extractedValues'] as const) {
      expect(cols[key], `${key} missing`).toBeDefined()
      expect(cols[key].notNull).toBe(false)
    }
  })

  it('edge: goodsReceiptLineItems extractionConfidence/extractorVersion are nullable', () => {
    const cols = getTableColumns(goodsReceiptLineItems)
    expect(cols.extractionConfidence, 'extractionConfidence missing').toBeDefined()
    expect(cols.extractorVersion, 'extractorVersion missing').toBeDefined()
    expect(cols.extractionConfidence.notNull).toBe(false)
    expect(cols.extractorVersion.notNull).toBe(false)
  })

  it.each(Object.entries(headers))('happy: %s exposes the snake_case db names', (_n, table) => {
    const cols = getTableColumns(table)
    expect(cols.reviewRequired?.name).toBe('review_required')
    expect(cols.reviewedAt?.name).toBe('reviewed_at')
    expect(cols.reviewedBy?.name).toBe('reviewed_by')
    expect(cols.detectedKind?.name).toBe('detected_kind')
    expect(cols.pageCount?.name).toBe('page_count')
  })

  it.each(Object.entries(lines))('happy: %s exposes the snake_case db names', (_n, table) => {
    const cols = getTableColumns(table)
    expect(cols.editedAt?.name).toBe('edited_at')
    expect(cols.editedBy?.name).toBe('edited_by')
    expect(cols.extractedValues?.name).toBe('extracted_values')
  })

  it('happy: goodsReceiptLineItems exposes extraction_confidence and extractor_version', () => {
    const cols = getTableColumns(goodsReceiptLineItems)
    expect(cols.extractionConfidence?.name).toBe('extraction_confidence')
    expect(cols.extractorVersion?.name).toBe('extractor_version')
  })
})
