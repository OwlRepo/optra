import * as XLSX from 'xlsx'
import { discrepancyDecisionOutcomeEnum, discrepancyFlagTypeEnum } from '@repo/db'
import {
  DECISIONS_HEADERS,
  FLAGS_HEADERS,
  FLAG_TYPE_LABELS,
  OUTCOME_LABELS,
  buildWorkbook,
  citationSource,
  evidenceFilename,
  type EvidenceCitation,
  type EvidenceDecisionRow,
  type EvidenceFlagRow,
} from './evidence-export'

const citation = (overrides: Partial<EvidenceCitation> = {}): EvidenceCitation => ({
  lineNumber: 1,
  sourceRow: null,
  sourceSheet: null,
  extractionConfidence: null,
  sourceKind: 'csv',
  editedAt: null,
  documentId: 'doc-1',
  documentName: 'po-march.csv',
  ...overrides,
})

const flag = (overrides: Partial<EvidenceFlagRow> = {}): EvidenceFlagRow => ({
  id: 'flag-1',
  createdAt: new Date('2026-10-01T08:30:00.000Z'),
  flagType: 'price_mismatch',
  status: 'open',
  sku: 'A1',
  poValue: '5.00',
  invoiceValue: '6.00',
  receivedValue: null,
  delta: '1.00',
  contractUnitPrice: null,
  reason: 'Price differs.',
  dismissedAt: null,
  dismissedByEmail: null,
  poLine: citation({ lineNumber: 3, sourceRow: 4, sourceSheet: 'Lines', documentName: 'po-march.xlsx' }),
  invoiceLine: citation({
    lineNumber: 2,
    sourceKind: 'pdf-extraction',
    extractionConfidence: 0.874,
    documentName: 'inv-77.pdf',
  }),
  receiptLine: null,
  ...overrides,
})

const decision = (overrides: Partial<EvidenceDecisionRow> = {}): EvidenceDecisionRow => ({
  id: 'dec-1',
  discrepancyFlagId: 'flag-1',
  outcome: 'approved_exception',
  note: 'Agreed with vendor by phone.',
  actorEmail: 'buyer@example.com',
  actorRole: 'owner',
  createdAt: new Date('2026-10-02T09:00:00.000Z'),
  ...overrides,
})

function read(buffer: Buffer) {
  const book = XLSX.read(buffer, { type: 'buffer' })
  const rows = (name: string) =>
    XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '', raw: true })
  return { book, rows }
}

describe('evidence-export', () => {
  it('error: every flag_type enum value has a non-empty, distinct human label', () => {
    const values = [...discrepancyFlagTypeEnum.enumValues]
    expect(Object.keys(FLAG_TYPE_LABELS).sort()).toEqual([...values].sort())
    for (const value of values) expect(FLAG_TYPE_LABELS[value].trim()).not.toBe('')
    expect(new Set(values.map((value) => FLAG_TYPE_LABELS[value])).size).toBe(values.length)
  })

  it('error: every decision outcome has a label, with the four documented words', () => {
    expect([...discrepancyDecisionOutcomeEnum.enumValues].sort()).toEqual(Object.keys(OUTCOME_LABELS).sort())
    expect(OUTCOME_LABELS).toEqual({
      false_positive: 'false positive',
      approved_exception: 'approved exception',
      vendor_dispute: 'vendor dispute',
      resolved: 'resolved',
    })
  })

  it('error: formula-looking text from documents or reviewers arrives neutralised in every text column', () => {
    const evil = '=HYPERLINK("http://evil.example","x")'
    const { rows } = read(
      buildWorkbook({
        flags: [
          flag({
            sku: evil,
            reason: `+${evil}`,
            dismissedByEmail: `@${evil}`,
            poLine: citation({ documentName: evil, sourceRow: 2 }),
          }),
        ],
        decisions: [decision({ note: `-${evil}`, actorEmail: `=${evil}` })],
      }),
    )

    const flags = rows('Flags')
    const header = flags[0] as string[]
    const row = flags[1] as string[]
    expect(row[header.indexOf('SKU')]).toBe(`'${evil}`)
    expect(row[header.indexOf('Reason')]).toBe(`'+${evil}`)
    expect(row[header.indexOf('Dismissed by')]).toBe(`'@${evil}`)
    expect(row[header.indexOf('PO document')]).toBe(`'${evil}`)

    const decisions = rows('Decisions')
    const dHeader = decisions[0] as string[]
    expect(decisions[1][dHeader.indexOf('Note')]).toBe(`'-${evil}`)
    expect(decisions[1][dHeader.indexOf('By')]).toBe(`'=${evil}`)
  })

  it.each([['0x10'], ['1e3'], [' 5 '], ['5 pcs'], ['Infinity'], ['1,000']])(
    'error: the value %j is not a plain decimal, so it stays text instead of becoming a number',
    (raw) => {
      const { rows } = read(buildWorkbook({ flags: [flag({ poValue: raw })], decisions: [] }))
      const header = rows('Flags')[0] as string[]

      expect(rows('Flags')[1][header.indexOf('PO value')]).toBe(raw)
    },
  )

  it('error: a non-numeric delta or contract unit price keeps its text instead of going blank', () => {
    const { rows } = read(
      buildWorkbook({ flags: [flag({ delta: 'n/a', contractUnitPrice: 'USD 5' })], decisions: [] }),
    )
    const header = rows('Flags')[0] as string[]

    expect(rows('Flags')[1][header.indexOf('Delta')]).toBe('n/a')
    expect(rows('Flags')[1][header.indexOf('Contract unit price')]).toBe('USD 5')
  })

  it('error: a formula-looking delta keeps its text but is neutralised', () => {
    const { rows } = read(buildWorkbook({ flags: [flag({ delta: '=1+1' })], decisions: [] }))
    const header = rows('Flags')[0] as string[]

    expect(rows('Flags')[1][header.indexOf('Delta')]).toBe("'=1+1")
  })

  it('edge: no citation yields an empty cell', () => {
    expect(citationSource(null)).toBe('')
  })

  it('edge: a spreadsheet line without a sheet name cites the row alone', () => {
    expect(citationSource(citation({ sourceRow: 7 }))).toBe('row 7')
  })

  it('edge: a line edited by a reviewer says so and outranks how it was first read', () => {
    expect(
      citationSource(citation({ extractionConfidence: 0.5, sourceKind: 'pdf-extraction', editedAt: '2026-10-03T00:00:00.000Z' })),
    ).toBe('edited by reviewer')
    expect(citationSource(citation({ sourceKind: 'manual', editedAt: '2026-10-03T00:00:00.000Z' }))).toBe(
      'edited by reviewer',
    )
  })

  it('edge: a line a reviewer added by hand says so', () => {
    expect(citationSource(citation({ sourceKind: 'manual' }))).toBe('added by reviewer')
  })

  it('edge: a photo read cites the photo and its rounded confidence', () => {
    expect(citationSource(citation({ sourceKind: 'image-extraction', extractionConfidence: 0.876 }))).toBe(
      'read from photo, 88% confidence',
    )
  })

  it('edge: a spreadsheet row wins over everything else, in the modal order (sheet, then row)', () => {
    expect(
      citationSource(citation({ sourceRow: 7, sourceSheet: 'Lines', editedAt: '2026-10-03T00:00:00.000Z', sourceKind: 'manual' })),
    ).toBe('sheet Lines, row 7')
  })

  it('edge: confidence is rounded to a whole percent', () => {
    expect(citationSource(citation({ extractionConfidence: 0.876, sourceKind: 'pdf-extraction' }))).toBe(
      'read from PDF, 88% confidence',
    )
  })

  it('edge: the date is the UTC day, not the local one', () => {
    expect(evidenceFilename(new Date('2026-10-08T23:59:59.000Z'))).toBe('optra-evidence-trail-2026-10-08.xlsx')
    expect(evidenceFilename(new Date('2026-10-09T00:00:00.000Z'))).toBe('optra-evidence-trail-2026-10-09.xlsx')
  })

  it('edge: zero flags still produce both sheets with only their header rows', () => {
    const { book, rows } = read(buildWorkbook({ flags: [], decisions: [] }))

    expect(book.SheetNames).toEqual(['Flags', 'Decisions'])
    expect(rows('Flags')).toEqual([[...FLAGS_HEADERS]])
    expect(rows('Decisions')).toEqual([[...DECISIONS_HEADERS]])
  })

  it('edge: a negative delta stays a number, not text with a quote prefix', () => {
    const { rows } = read(buildWorkbook({ flags: [flag({ delta: '-2.50' })], decisions: [] }))
    const header = rows('Flags')[0] as string[]

    expect(rows('Flags')[1][header.indexOf('Delta')]).toBe(-2.5)
  })

  it('edge: a flag without decisions leaves the decision columns empty', () => {
    const { rows } = read(buildWorkbook({ flags: [flag()], decisions: [] }))
    const header = rows('Flags')[0] as string[]
    const row = rows('Flags')[1]

    for (const name of ['Latest decision', 'Decided by', 'Decided at', 'Dismissed by', 'Dismissed at']) {
      expect(row[header.indexOf(name)]).toBe('')
    }
  })

  it('edge: with several decisions the Flags sheet shows the newest and the Decisions sheet lists oldest first', () => {
    const { rows } = read(
      buildWorkbook({
        flags: [flag()],
        decisions: [
          decision({ id: 'd1', outcome: 'vendor_dispute', note: 'first', createdAt: new Date('2026-10-02T09:00:00.000Z') }),
          decision({
            id: 'd2',
            outcome: 'resolved',
            note: 'second',
            actorEmail: 'admin@example.com',
            createdAt: new Date('2026-10-03T10:15:00.000Z'),
          }),
        ],
      }),
    )
    const header = rows('Flags')[0] as string[]
    const row = rows('Flags')[1]

    expect(row[header.indexOf('Latest decision')]).toBe('resolved')
    expect(row[header.indexOf('Decided by')]).toBe('admin@example.com')
    expect(row[header.indexOf('Decided at')]).toBe('2026-10-03T10:15:00.000Z')
    expect(rows('Decisions').slice(1).map((r) => r[3])).toEqual(['first', 'second'])
  })

  it('regression: the header rows are exactly the documented columns', () => {
    expect([...FLAGS_HEADERS]).toEqual([
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
    ])
    expect([...DECISIONS_HEADERS]).toEqual(['Flag ID', 'SKU', 'Outcome', 'Note', 'By', 'Role', 'At (UTC ISO)'])
  })

  it('happy: a spreadsheet line cites row and sheet', () => {
    expect(citationSource(citation({ sourceRow: 4, sourceSheet: 'Lines' }))).toBe('sheet Lines, row 4')
  })

  it('happy: a PDF line cites the read and its confidence', () => {
    expect(citationSource(citation({ extractionConfidence: 0.9, sourceKind: 'pdf-extraction' }))).toBe(
      'read from PDF, 90% confidence',
    )
  })

  it('happy: a flag row carries label, document names, line numbers, sources and the latest decision', () => {
    const { book, rows } = read(
      buildWorkbook({
        flags: [flag({ status: 'dismissed', dismissedByEmail: 'buyer@example.com', dismissedAt: new Date('2026-10-02T09:00:00.000Z') })],
        decisions: [decision()],
      }),
    )
    const header = rows('Flags')[0] as string[]
    const row = rows('Flags')[1]
    const cell = (name: string) => row[header.indexOf(name)]

    expect(book.SheetNames).toEqual(['Flags', 'Decisions'])
    expect(header).toEqual([...FLAGS_HEADERS])
    expect(cell('Flag ID')).toBe('flag-1')
    expect(cell('Created (UTC ISO)')).toBe('2026-10-01T08:30:00.000Z')
    expect(cell('Type')).toBe(FLAG_TYPE_LABELS.price_mismatch)
    expect(cell('Status')).toBe('dismissed')
    expect(cell('SKU')).toBe('A1')
    expect(cell('PO document')).toBe('po-march.xlsx')
    expect(cell('PO line')).toBe(3)
    expect(cell('PO source')).toBe('sheet Lines, row 4')
    expect(cell('Invoice document')).toBe('inv-77.pdf')
    expect(cell('Invoice line')).toBe(2)
    expect(cell('Invoice source')).toBe('read from PDF, 87% confidence')
    expect(cell('Goods receipt line')).toBe('')
    expect(cell('Delta')).toBe(1)
    expect(cell('Reason')).toBe('Price differs.')
    expect(cell('Latest decision')).toBe('approved exception')
    expect(cell('Decided by')).toBe('buyer@example.com')
    expect(cell('Decided at')).toBe('2026-10-02T09:00:00.000Z')
    expect(cell('Dismissed by')).toBe('buyer@example.com')
    expect(cell('Dismissed at')).toBe('2026-10-02T09:00:00.000Z')
  })

  it('happy: the Decisions sheet row carries flag id, SKU, outcome label, note, actor, role and time', () => {
    const { rows } = read(buildWorkbook({ flags: [flag()], decisions: [decision()] }))

    expect(rows('Decisions')[1]).toEqual([
      'flag-1',
      'A1',
      'approved exception',
      'Agreed with vendor by phone.',
      'buyer@example.com',
      'owner',
      '2026-10-02T09:00:00.000Z',
    ])
  })
})
