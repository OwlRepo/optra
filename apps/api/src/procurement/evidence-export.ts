import * as XLSX from 'xlsx'
import { safeCell } from '../common/spreadsheet/safe-cell'

export interface EvidenceCitation {
  lineNumber: number
  sourceRow: number | null
  sourceSheet: string | null
  extractionConfidence: number | null
  sourceKind: string
  editedAt: string | null
  documentId: string
  documentName: string | null
}

export type EvidenceFlagType =
  | 'quantity_mismatch'
  | 'price_mismatch'
  | 'missing_on_invoice'
  | 'missing_on_po'
  | 'short_receipt'
  | 'invoice_exceeds_received'
  | 'uom_mismatch'
  | 'currency_mismatch'
  | 'contract_price_variance'
  | 'contract_price_unavailable'

export type EvidenceOutcome = 'false_positive' | 'approved_exception' | 'vendor_dispute' | 'resolved'

export interface EvidenceFlagRow {
  id: string
  createdAt: Date
  flagType: EvidenceFlagType
  status: string
  sku: string | null
  poValue: string | null
  invoiceValue: string | null
  receivedValue: string | null
  delta: string | null
  contractUnitPrice: string | null
  reason: string
  dismissedAt: Date | null
  dismissedByEmail: string | null
  poLine: EvidenceCitation | null
  invoiceLine: EvidenceCitation | null
  receiptLine: EvidenceCitation | null
  // Present on rows read from the database; not used by the workbook.
  comparisonRunId?: string | null
}

export interface EvidenceDecisionRow {
  id: string
  discrepancyFlagId: string
  outcome: EvidenceOutcome
  note: string
  actorEmail: string | null
  actorRole: string
  createdAt: Date
}

export const FLAG_TYPE_LABELS: Record<EvidenceFlagType, string> = {
  quantity_mismatch: 'Quantity mismatch',
  price_mismatch: 'Price mismatch',
  missing_on_invoice: 'Missing on invoice',
  missing_on_po: 'Missing on purchase order',
  short_receipt: 'Short receipt',
  invoice_exceeds_received: 'Invoice exceeds received',
  uom_mismatch: 'Unit of measure mismatch',
  currency_mismatch: 'Currency mismatch',
  contract_price_variance: 'Contract price variance',
  contract_price_unavailable: 'Contract price unavailable',
}

export const OUTCOME_LABELS: Record<EvidenceOutcome, string> = {
  false_positive: 'false positive',
  approved_exception: 'approved exception',
  vendor_dispute: 'vendor dispute',
  resolved: 'resolved',
}

export const FLAGS_HEADERS = [
  'Flag ID',
  'Created (UTC ISO)',
  'Type',
  'Status',
  'SKU',
  'PO document',
  'PO line',
  'PO source',
  'Invoice document',
  'Invoice line',
  'Invoice source',
  'Goods receipt line',
  'Receipt source',
  'PO value',
  'Invoice value',
  'Received value',
  'Delta',
  'Contract unit price',
  'Reason',
  'Latest decision',
  'Decided by',
  'Decided at',
  'Dismissed by',
  'Dismissed at',
] as const

export const DECISIONS_HEADERS = ['Flag ID', 'SKU', 'Outcome', 'Note', 'By', 'Role', 'At (UTC ISO)'] as const

/** Mirrors `citationText` in discrepancy-review-modal.tsx. */
export function citationSource(citation: EvidenceCitation | null): string {
  if (!citation) return ''
  if (citation.sourceRow !== null) {
    return citation.sourceSheet ? `sheet ${citation.sourceSheet}, row ${citation.sourceRow}` : `row ${citation.sourceRow}`
  }
  if (citation.editedAt) return 'edited by reviewer'
  if (citation.sourceKind === 'manual') return 'added by reviewer'
  const percent =
    citation.extractionConfidence === null ? null : `${Math.round(citation.extractionConfidence * 100)}% confidence`
  if (citation.sourceKind === 'image-extraction' && percent) return `read from photo, ${percent}`
  if (percent) return `read from PDF, ${percent}`
  return ''
}

export function evidenceFilename(date: Date): string {
  return `optra-evidence-trail-${date.toISOString().slice(0, 10)}.xlsx`
}

type Cell = string | number | null

const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/

// Only a plain decimal becomes a number; anything else keeps its text (through
// safeCell) so no value is silently blanked or reinterpreted.
function valueCell(value: string | null): Cell {
  if (value === null) return null
  return PLAIN_DECIMAL.test(value) ? Number(value) : safeCell(value)
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null)

export function buildWorkbook({
  flags,
  decisions,
}: {
  flags: EvidenceFlagRow[]
  decisions: EvidenceDecisionRow[]
}): Buffer {
  const ordered = [...decisions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const latest = new Map<string, EvidenceDecisionRow>()
  for (const decision of ordered) latest.set(decision.discrepancyFlagId, decision)
  const skuByFlag = new Map(flags.map((flag) => [flag.id, flag.sku]))

  const flagRows = flags.map((flag): Cell[] => {
    const last = latest.get(flag.id)
    return [
      safeCell(flag.id),
      flag.createdAt.toISOString(),
      safeCell(FLAG_TYPE_LABELS[flag.flagType]),
      safeCell(flag.status),
      safeCell(flag.sku),
      safeCell(flag.poLine?.documentName ?? null),
      flag.poLine?.lineNumber ?? null,
      safeCell(citationSource(flag.poLine)),
      safeCell(flag.invoiceLine?.documentName ?? null),
      flag.invoiceLine?.lineNumber ?? null,
      safeCell(citationSource(flag.invoiceLine)),
      flag.receiptLine?.lineNumber ?? null,
      safeCell(citationSource(flag.receiptLine)),
      valueCell(flag.poValue),
      valueCell(flag.invoiceValue),
      valueCell(flag.receivedValue),
      valueCell(flag.delta),
      valueCell(flag.contractUnitPrice),
      safeCell(flag.reason),
      last ? OUTCOME_LABELS[last.outcome] : null,
      last ? safeCell(last.actorEmail) : null,
      last ? last.createdAt.toISOString() : null,
      safeCell(flag.dismissedByEmail),
      iso(flag.dismissedAt),
    ]
  })

  const decisionRows = ordered.map((decision): Cell[] => [
    safeCell(decision.discrepancyFlagId),
    safeCell(skuByFlag.get(decision.discrepancyFlagId) ?? null),
    OUTCOME_LABELS[decision.outcome],
    safeCell(decision.note),
    safeCell(decision.actorEmail),
    safeCell(decision.actorRole),
    decision.createdAt.toISOString(),
  ])

  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[...FLAGS_HEADERS], ...flagRows]), 'Flags')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[...DECISIONS_HEADERS], ...decisionRows]), 'Decisions')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
