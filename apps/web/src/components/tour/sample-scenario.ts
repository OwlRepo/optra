import type { PhotoCompareCandidate, PhotoCompareQuery, PhotoCompareVerdict } from '@repo/ui'
import type { DiscrepancyFlag } from '@/lib/api/procurement'
import { DEMO_CATALOG_PHOTO } from '@/lib/landing-demo-docs'

// The tour's made-up scenario. It never touches the API: every id is prefixed
// `sample-` so it can not be mistaken for (or sent as) a real workspace row.

export type SampleDocKind = 'purchase_order' | 'invoice' | 'goods_receipt'

export const SAMPLE_VENDOR = 'Northwind Fasteners'

export const SAMPLE_DOCS: { kind: SampleDocKind; number: string; vendor: string; lines: number }[] = [
  { kind: 'purchase_order', number: 'PO-4417', vendor: SAMPLE_VENDOR, lines: 6 },
  { kind: 'invoice', number: 'INV-8812', vendor: SAMPLE_VENDOR, lines: 6 },
  { kind: 'goods_receipt', number: 'GRN-2203', vendor: SAMPLE_VENDOR, lines: 6 },
]

export const SAMPLE_DOC_LABEL: Record<SampleDocKind, string> = {
  purchase_order: 'Purchase order',
  invoice: 'Invoice',
  goods_receipt: 'Goods receipt',
}

const CREATED_AT = '2026-10-03T00:00:00.000Z'

const BASE_FLAG = {
  workspaceId: 'sample-workspace',
  purchaseOrderId: 'sample-po-4417',
  invoiceId: 'sample-inv-8812',
  comparisonRunId: 'sample-run-1',
  contractUnitPrice: null,
  contractTermId: null,
  status: 'open',
  dismissedAt: null,
  dismissedBy: null,
  createdAt: CREATED_AT,
} as const

// Only the two real findings. The matched line is a separate teal row, not a flag.
export const SAMPLE_FLAGS: DiscrepancyFlag[] = [
  {
    ...BASE_FLAG,
    id: 'sample-flag-price',
    poLineItemId: 'sample-po-line-4',
    invoiceLineItemId: 'sample-inv-line-3',
    goodsReceiptLineItemId: 'sample-grn-line-2',
    sku: 'HX-M8-40',
    flagType: 'price_mismatch',
    poValue: '0.42',
    receivedValue: null,
    invoiceValue: '0.47',
    poUnitPrice: '0.42',
    invoiceUnitPrice: '0.47',
    delta: '0.05',
    reason: 'Invoice unit price is above the agreed purchase order price.',
    poLine: { lineNumber: null, sourceRow: 4, sourceSheet: null, extractionConfidence: null, documentId: 'sample-po-4417' },
    invoiceLine: { lineNumber: 3, sourceRow: null, sourceSheet: null, extractionConfidence: 0.96, documentId: 'sample-inv-8812' },
    receiptLine: { lineNumber: 2, sourceRow: null, sourceSheet: null, extractionConfidence: null, documentId: 'sample-grn-2203' },
  },
  {
    ...BASE_FLAG,
    id: 'sample-flag-short',
    poLineItemId: 'sample-po-line-5',
    invoiceLineItemId: 'sample-inv-line-4',
    goodsReceiptLineItemId: 'sample-grn-line-3',
    sku: 'WS-M8-A2',
    flagType: 'short_receipt',
    poValue: '500',
    receivedValue: '480',
    invoiceValue: '500',
    poUnitPrice: '0.08',
    invoiceUnitPrice: '0.08',
    delta: '-20',
    reason: 'Fewer units were received than were ordered and billed.',
    poLine: { lineNumber: null, sourceRow: 5, sourceSheet: null, extractionConfidence: null, documentId: 'sample-po-4417' },
    invoiceLine: { lineNumber: 4, sourceRow: null, sourceSheet: null, extractionConfidence: 0.95, documentId: 'sample-inv-8812' },
    receiptLine: { lineNumber: 3, sourceRow: null, sourceSheet: null, extractionConfidence: null, documentId: 'sample-grn-2203' },
  },
]

export const SAMPLE_MATCHED_LINE: { sku: string; description: string } = {
  sku: 'NT-M8-ZP',
  description: 'M8 hex nut, zinc plated',
}

export const SAMPLE_PHOTO_MATCH: {
  query: PhotoCompareQuery
  candidate: PhotoCompareCandidate
  verdict: PhotoCompareVerdict
} = {
  query: { sku: 'HX-M8-40', description: 'Hex bolt M8 x 40 mm, stainless steel' },
  candidate: {
    sku: 'NW-HX-M8-40',
    description: 'Hex bolt M8 x 40 mm, A2 stainless',
    photoSrc: DEMO_CATALOG_PHOTO,
    vendorName: SAMPLE_VENDOR,
  },
  verdict: {
    score: 0.94,
    isMatch: true,
    reason: 'Same head style, thread and length as the request, and the finish matches.',
  },
}
