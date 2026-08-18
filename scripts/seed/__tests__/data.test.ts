// Invariants the seeded data must satisfy before it ever reaches Postgres.
// Every assertion here corresponds to a real constraint or a real UI
// expectation — a violation would either fail the insert or produce a demo
// with dead links and empty filters.
import { describe, expect, it } from 'vitest'
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from '../config'
import { buildChatMessageRows, buildChatSessionRows } from '../data/chat'
import { buildDocumentRows, seedDocuments } from '../data/documents'
import { buildEventRows, buildScrapeRunRows } from '../data/events'
import {
  buildBackgroundRunRows,
  buildFaqDraftRows,
  buildReviewFlagRows,
  buildSavedRefinedMessageRows,
} from '../data/insights'
import { buildQueryMetricRows } from '../data/metrics'
import {
  buildDiscrepancyFlagRows,
  buildInvoiceLineItemRows,
  buildInvoiceRows,
  buildPoLineItemRows,
  buildPurchaseOrderRows,
} from '../data/procurement'
import { buildCatalogItemRows, buildCatalogMatchRows, buildCatalogRows, buildVendorRows } from '../data/catalog'
import { buildTicketRows, indexedTickets, seedTickets, ticketChunkContent, transcriptHash } from '../data/tickets'

const documentIds = new Set(seedDocuments.map(d => d.id))
const ticketIds = new Set(seedTickets.map(t => t.id))

describe('documents', () => {
  it('has enough rows to exercise the offset pager', () => {
    expect(seedDocuments.length).toBeGreaterThanOrEqual(25)
  })

  it('covers the done / processing / failed statuses', () => {
    const statuses = new Set(seedDocuments.map(d => d.status))
    expect(statuses).toContain('done')
    expect(statuses).toContain('processing')
    expect(statuses).toContain('failed')
  })

  it('gives the failed document a real error message', () => {
    const failed = seedDocuments.filter(d => d.status === 'failed')
    expect(failed.length).toBeGreaterThan(0)
    failed.forEach(d => expect((d.lastError ?? '').length).toBeGreaterThan(10))
  })

  it('never sets storageKey, since download would stream a nonexistent S3 object', () => {
    buildDocumentRows().forEach(row => expect(row.storageKey).toBeNull())
  })

  it('keeps sourceUrl unique per knowledge base (partial unique index)', () => {
    const pairs = buildDocumentRows().map(r => `${r.knowledgeBaseId}::${r.sourceUrl}`)
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it('scopes every row to the demo workspace', () => {
    buildDocumentRows().forEach(row => expect(row.workspaceId).toBe(DEMO_WORKSPACE_ID))
  })
})

describe('tickets', () => {
  it('has enough rows to exercise the offset pager', () => {
    expect(seedTickets.length).toBeGreaterThanOrEqual(25)
  })

  it('hashes distinct transcripts, satisfying the (workspace, hash) unique index', () => {
    const hashes = buildTicketRows().map(r => r.transcriptHash)
    expect(new Set(hashes).size).toBe(hashes.length)
    hashes.forEach(h => expect(h).toMatch(/^[0-9a-f]{64}$/))
  })

  it('computes the hash from the transcript itself', () => {
    const row = buildTicketRows()[0]!
    expect(row.transcriptHash).toBe(transcriptHash(row.transcript))
  })

  it('leaves every filterable facet populated', () => {
    const rows = buildTicketRows()
    expect(new Set(rows.map(r => r.status))).toEqual(new Set(['done', 'pending', 'failed']))
    expect(new Set(rows.filter(r => r.severity).map(r => r.severity))).toEqual(new Set(['low', 'medium', 'high']))
    expect(rows.some(r => r.usefulness === 'useful')).toBe(true)
    expect(rows.some(r => r.usefulness === 'not_useful')).toBe(true)
  })

  it('produces indexed tickets (done + reviewed + useful) for the indexed filter', () => {
    const indexed = indexedTickets()
    expect(indexed.length).toBeGreaterThanOrEqual(5)
    const rows = buildTicketRows()
    indexed.forEach(t => {
      const row = rows.find(r => r.id === t.id)!
      expect(row.status).toBe('done')
      expect(row.reviewedBy).not.toBeNull()
      expect(row.usefulness).toBe('useful')
    })
  })

  it('gives done tickets their full extraction fields and confidences', () => {
    buildTicketRows()
      .filter(r => r.status === 'done')
      .forEach(row => {
        expect(row.title).toBeTruthy()
        expect(row.issueSummary).toBeTruthy()
        expect(row.reproSteps).toBeTruthy()
        expect(row.hypothesizedRootCause).toBeTruthy()
        expect(row.nextAction).toBeTruthy()
        Object.values(row.fieldConfidence).forEach(v => {
          expect(v).toBeGreaterThan(0)
          expect(v).toBeLessThanOrEqual(1)
        })
      })
  })

  it('leaves non-done tickets without extraction output', () => {
    buildTicketRows()
      .filter(r => r.status !== 'done')
      .forEach(row => {
        expect(row.title).toBeNull()
        expect(row.severity).toBeNull()
      })
  })
})

describe('chunk invariants', () => {
  // chunks_exactly_one_parent_check + chunks_ticket_id_unique_idx.
  const chunkParents = [
    ...seedDocuments
      .filter(d => d.status === 'done')
      .flatMap(d => d.sections.map(() => ({ documentId: d.id as string | null, ticketId: null as string | null }))),
    ...indexedTickets().map(t => ({ documentId: null as string | null, ticketId: t.id as string | null })),
  ]

  it('sets exactly one parent per chunk', () => {
    chunkParents.forEach(c => {
      expect((c.documentId !== null) !== (c.ticketId !== null)).toBe(true)
    })
  })

  it('creates at most one chunk per ticket', () => {
    const ticketChunks = chunkParents.filter(c => c.ticketId).map(c => c.ticketId)
    expect(new Set(ticketChunks).size).toBe(ticketChunks.length)
  })

  it('never chunks a document that is not done', () => {
    const notDone = new Set(seedDocuments.filter(d => d.status !== 'done').map(d => d.id))
    chunkParents.forEach(c => expect(notDone.has(c.documentId ?? '')).toBe(false))
  })

  it('gives every ticket chunk non-empty content', () => {
    indexedTickets().forEach(t => expect(ticketChunkContent(t).length).toBeGreaterThan(50))
  })
})

describe('chat', () => {
  const sessions = buildChatSessionRows()
  const messages = buildChatMessageRows()

  it('assigns every session to the demo user and workspace', () => {
    sessions.forEach(s => {
      expect(s.userId).toBe(DEMO_USER_ID)
      expect(s.workspaceId).toBe(DEMO_WORKSPACE_ID)
    })
  })

  it('uses unique message ids and real session ids', () => {
    const ids = messages.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    const sessionIds = new Set(sessions.map(s => s.id))
    messages.forEach(m => expect(sessionIds.has(m.sessionId)).toBe(true))
  })

  it('only puts sources on assistant messages', () => {
    messages.forEach(m => {
      if (m.role === 'user') expect(m.sources).toBeNull()
      else expect(Array.isArray(m.sources)).toBe(true)
    })
  })

  it('cites only documents and tickets that exist', () => {
    messages
      .filter(m => m.role === 'assistant')
      .forEach(m => {
        const sources = m.sources as { sourceType: string; documentId?: string; ticketId?: string }[]
        sources.forEach(source => {
          if (source.sourceType === 'document') expect(documentIds.has(source.documentId!)).toBe(true)
          if (source.sourceType === 'ticket') expect(ticketIds.has(source.ticketId!)).toBe(true)
        })
      })
  })

  it('never writes the generated search_vector column', () => {
    messages.forEach(m => expect(m).not.toHaveProperty('searchVector'))
  })
})

describe('chat query metrics', () => {
  const assistants = buildChatMessageRows().filter(m => m.role === 'assistant')
  const rows = buildQueryMetricRows(assistants)

  it('anchors every row to a real assistant message', () => {
    const ids = new Set(assistants.map(m => m.id))
    rows.forEach(r => expect(ids.has(r.chatMessageId)).toBe(true))
  })

  it('produces a non-trivial fallback rate and cache-hit rate', () => {
    const fallbackRate = rows.filter(r => r.isFallback).length / rows.length
    const hitRate = rows.filter(r => r.cacheStatus === 'exact' || r.cacheStatus === 'semantic').length / rows.length
    expect(fallbackRate).toBeGreaterThan(0.05)
    expect(fallbackRate).toBeLessThan(0.4)
    expect(hitRate).toBeGreaterThan(0.1)
  })

  it('includes rows below the 0.4 low-score threshold so that panel is populated', () => {
    expect(rows.filter(r => (r.topScore ?? 1) < 0.4).length).toBeGreaterThanOrEqual(5)
  })

  it('keeps all rows inside the 30-day summary window', () => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    rows.forEach(r => expect(r.createdAt.getTime()).toBeGreaterThan(cutoff))
  })
})

describe('events and scrape runs', () => {
  it('covers every workspace_event_type value', () => {
    const types = new Set(buildEventRows().map(e => e.type))
    expect(types).toEqual(
      new Set([
        'document_ingested',
        'document_failed',
        'scrape_completed',
        'scrape_failed',
        'ticket_extracted',
        'ticket_failed',
      ]),
    )
  })

  it('points scrape events at the scrape runs that are actually inserted', () => {
    const runIds = new Set(buildScrapeRunRows('kb').map(r => r.id))
    buildEventRows()
      .filter(e => e.type.startsWith('scrape_'))
      .forEach(e => expect(runIds.has(e.entityId)).toBe(true))
  })
})

describe('insights', () => {
  it('flags only documents and tickets that exist', () => {
    buildReviewFlagRows().forEach(f => {
      expect(documentIds.has(f.documentId)).toBe(true)
      expect(ticketIds.has(f.ticketId)).toBe(true)
      expect(f.reason.length).toBeGreaterThan(20)
    })
  })

  it('gives FAQ drafts real ticket provenance and every status', () => {
    const drafts = buildFaqDraftRows()
    drafts.forEach(d => {
      expect(d.ticketIds.length).toBeGreaterThan(0)
      d.ticketIds.forEach(id => expect(ticketIds.has(id)).toBe(true))
      expect(d.clusterSize).toBeGreaterThan(0)
    })
    expect(new Set(drafts.map(d => d.status))).toEqual(new Set(['pending', 'approved', 'rejected']))
  })

  it('records background runs for the jobs that produced the above', () => {
    const kinds = new Set(buildBackgroundRunRows().map(r => r.kind))
    expect(kinds).toContain('freshness-check')
    expect(kinds).toContain('faq-draft')
    expect(kinds).toContain('topic-gap')
  })

  it('scopes saved refined messages to the demo user', () => {
    buildSavedRefinedMessageRows().forEach(r => expect(r.userId).toBe(DEMO_USER_ID))
  })
})

describe('procurement', () => {
  const poLines = buildPoLineItemRows()
  const invoiceLines = buildInvoiceLineItemRows()

  it('passes every numeric column as a string', () => {
    ;[...poLines, ...invoiceLines].forEach(line => {
      expect(typeof line.quantity).toBe('string')
      expect(typeof line.unitPrice).toBe('string')
      expect(typeof line.lineTotal).toBe('string')
    })
    buildDiscrepancyFlagRows().forEach(flag => {
      if (flag.delta !== null) expect(typeof flag.delta).toBe('string')
    })
    buildCatalogMatchRows().forEach(match => expect(typeof match.score).toBe('string'))
  })

  it('computes lineTotal as quantity × unitPrice', () => {
    ;[...poLines, ...invoiceLines].forEach(line => {
      expect(Number(line.lineTotal)).toBeCloseTo(Number(line.quantity) * Number(line.unitPrice), 2)
    })
  })

  it('reports a rowCount matching the line items actually inserted', () => {
    buildPurchaseOrderRows().forEach(po => {
      expect(po.rowCount).toBe(poLines.filter(l => l.purchaseOrderId === po.id).length)
    })
    buildInvoiceRows().forEach(inv => {
      expect(inv.rowCount).toBe(invoiceLines.filter(l => l.invoiceId === inv.id).length)
    })
  })

  it('covers all four discrepancy types with real line-item references', () => {
    const flags = buildDiscrepancyFlagRows()
    expect(new Set(flags.map(f => f.flagType))).toEqual(
      new Set(['quantity_mismatch', 'price_mismatch', 'missing_on_invoice', 'missing_on_po']),
    )
    const poLineIds = new Set(poLines.map(l => l.id))
    const invoiceLineIds = new Set(invoiceLines.map(l => l.id))
    flags.forEach(f => {
      if (f.poLineItemId) expect(poLineIds.has(f.poLineItemId as string)).toBe(true)
      if (f.invoiceLineItemId) expect(invoiceLineIds.has(f.invoiceLineItemId as string)).toBe(true)
      expect(f.status).toBe('open')
    })
  })
})

describe('catalog', () => {
  it('links catalogs, items and matches to rows that exist', () => {
    const vendorIds = new Set(buildVendorRows().map(v => v.id))
    const catalogIds = new Set(buildCatalogRows().map(c => c.id))
    const itemIds = new Set(buildCatalogItemRows().map(i => i.id))

    buildCatalogRows().forEach(c => expect(vendorIds.has(c.vendorId)).toBe(true))
    buildCatalogItemRows().forEach(i => expect(catalogIds.has(i.catalogId)).toBe(true))
    buildCatalogMatchRows().forEach(m => {
      expect(itemIds.has(m.catalogItemId)).toBe(true)
      expect(vendorIds.has(m.vendorId)).toBe(true)
      expect(m.reason.length).toBeGreaterThan(20)
    })
  })

  it('covers both match types and both verdicts', () => {
    const matches = buildCatalogMatchRows()
    expect(new Set(matches.map(m => m.matchType))).toEqual(new Set(['sourcing', 'compliance']))
    expect(new Set(matches.map(m => m.isMatch))).toEqual(new Set([true, false]))
  })

  it('reports a rowCount matching the items inserted', () => {
    const items = buildCatalogItemRows()
    buildCatalogRows().forEach(c => {
      expect(c.rowCount).toBe(items.filter(i => i.catalogId === c.id).length)
    })
  })
})
