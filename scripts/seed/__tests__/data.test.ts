// Invariants the seeded data must satisfy before it ever reaches Postgres.
// Every assertion here corresponds to a real constraint or a real UI
// expectation — a violation would either fail the insert or produce a demo
// with dead links and empty filters.
import { describe, expect, it } from 'vitest'
import { workspaceEventTypeEnum } from '@repo/db'
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from '../config'
import { buildChatMessageRows, buildChatSessionRows } from '../data/chat'
import { buildDocumentRows, seedDocuments } from '../data/documents'
import { buildEventRows, buildScrapeRunRows } from '../data/events'
import { buildVendorPriceTermRows } from '../data/price-terms'
import {
  buildBackgroundRunRows,
  buildFaqDraftRows,
  buildReviewFlagRows,
  buildSavedRefinedMessageRows,
} from '../data/insights'
import { buildQueryMetricRows } from '../data/metrics'
import {
  buildComparisonRunGoodsReceiptRows,
  buildComparisonRunRows,
  buildDiscrepancyFlagRows,
  buildInvoiceLineItemRows,
  buildGoodsReceiptLineItemRows,
  buildGoodsReceiptRows,
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

describe('vendor price terms (S9)', () => {
  const terms = buildVendorPriceTermRows()

  // The whole point of the seeded terms: the demo opens on a workspace buying
  // ON contract. A term that disagreed with its own purchase order would
  // manufacture an exception out of nothing, which is the defect S6 found in
  // the seeded discrepancy flags.
  it('agrees with what the seeded purchase orders actually cost', () => {
    const poPriceOf = new Map(
      buildPoLineItemRows().map(line => [`${line.sku}`.toLowerCase(), line.unitPrice as string]),
    )

    terms
      .filter(term => term.effectiveTo === null)
      .forEach(term => {
        expect(poPriceOf.get(term.skuKey)).toBe(term.unitPrice)
      })
  })

  it('leaves exactly one open window per vendor, item, unit and currency', () => {
    const openKeys = terms
      .filter(term => term.effectiveTo === null)
      .map(term => `${term.vendorId}:${term.skuKey}:${term.uom ?? ''}:${term.currency}`)

    expect(new Set(openKeys).size).toBe(openKeys.length)
  })

  it('closes a superseded window exactly where its replacement begins', () => {
    const byId = new Map(terms.map(term => [term.id, term]))
    const replacements = terms.filter(term => term.supersedesId !== null)

    expect(replacements.length).toBeGreaterThan(0)
    replacements.forEach(term => {
      const older = byId.get(term.supersedesId!)
      expect(older).toBeDefined()
      // Half-open [from, to): no instant covered twice, none left uncovered.
      expect(older!.effectiveTo?.getTime()).toBe(term.effectiveFrom.getTime())
      expect(older!.skuKey).toBe(term.skuKey)
      expect(older!.vendorId).toBe(term.vendorId)
    })
  })

  it('starts every window before the oldest seeded purchase order', () => {
    const oldestPo = Math.min(...buildPurchaseOrderRows().map(po => po.createdAt.getTime()))
    terms.forEach(term => expect(term.effectiveFrom.getTime()).toBeLessThan(oldestPo))
  })

  it('states a currency on every term, because a price without one means nothing', () => {
    terms.forEach(term => expect(term.currency).toMatch(/^[A-Z]{3}$/))
  })
})

describe('events and scrape runs', () => {
  // Derived from the enum, not a hand-copied list. The previous version named
  // six values under a claim of total coverage, so adding a seventh would have
  // left the claim true-looking and false.
  it('covers every workspace_event_type value', () => {
    const types = new Set(buildEventRows().map(e => e.type))
    expect(types).toEqual(new Set(workspaceEventTypeEnum.enumValues))
  })

  it('points comparison events at comparison runs that are actually inserted', () => {
    const runs = buildComparisonRunRows()
    const byId = new Map(runs.map(run => [run.id, run]))

    buildEventRows()
      .filter(e => e.type.startsWith('comparison_'))
      .forEach(e => {
        const run = byId.get(e.entityId)
        expect(run).toBeDefined()
        // The event has to agree with the run it names, or the demo shows a
        // feed contradicting the history it links to.
        expect(run!.status).toBe(e.type === 'comparison_flagged' ? 'succeeded' : 'failed')
        if (e.type === 'comparison_flagged') expect(run!.flagCount).toBeGreaterThan(0)
      })
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

  // S3b. The PO/vendor and invoice/PO correspondences used to exist only as
  // matching strings in the row names; these assert they are now real keys the
  // database will enforce.
  // S5 receiving fixtures. S6 sums accepted quantities across receipts, so the
  // shapes it has to handle need to exist in the demo data before it is built.
  it('links every goods receipt to a seeded purchase order', () => {
    const poIds = new Set(buildPurchaseOrderRows().map(po => po.id))
    const receipts = buildGoodsReceiptRows()

    expect(receipts.length).toBeGreaterThan(0)
    receipts.forEach(grn => expect(poIds.has(grn.purchaseOrderId)).toBe(true))
  })

  it('gives at least one purchase order more than one receipt (POLICY v1 #14)', () => {
    const perPo = new Map<string, number>()
    buildGoodsReceiptRows().forEach(grn => {
      perPo.set(grn.purchaseOrderId, (perPo.get(grn.purchaseOrderId) ?? 0) + 1)
    })

    expect([...perPo.values()].some(count => count > 1)).toBe(true)
  })

  it('reports a rowCount matching the receipt lines actually inserted', () => {
    const lines = buildGoodsReceiptLineItemRows()
    buildGoodsReceiptRows().forEach(grn => {
      expect(grn.rowCount).toBe(lines.filter(l => l.goodsReceiptId === grn.id).length)
    })
  })

  // §1B / POLICY v1 #14: "not stated" must reach the column as null, never 0 —
  // and at least one fixture has to exercise that path or S6 never sees it.
  it('leaves accepted quantity null on at least one receipt line, and never writes a bare zero string for it', () => {
    const lines = buildGoodsReceiptLineItemRows()

    expect(lines.some(l => l.quantityAccepted === null)).toBe(true)
    lines.forEach(l => {
      expect(l.quantityReceived === null || typeof l.quantityReceived === 'string').toBe(true)
      expect(l.quantityAccepted === null || typeof l.quantityAccepted === 'string').toBe(true)
      expect(l.quantityRejected === null || typeof l.quantityRejected === 'string').toBe(true)
    })
  })

  it('includes a receipt that records a rejected quantity', () => {
    const lines = buildGoodsReceiptLineItemRows()

    expect(lines.some(l => l.quantityRejected !== null && Number(l.quantityRejected) > 0)).toBe(true)
  })

  it('gives every receipt line a unique id', () => {
    const ids = buildGoodsReceiptLineItemRows().map(l => l.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('points every purchase order at a seeded vendor', () => {
    const vendorIds = new Set(buildVendorRows().map(v => v.id))
    const pos = buildPurchaseOrderRows()

    expect(pos.length).toBeGreaterThan(0)
    pos.forEach(po => {
      expect(po.vendorId).toBeTruthy()
      expect(vendorIds.has(po.vendorId)).toBe(true)
    })
  })

  it('links every invoice to a seeded purchase order', () => {
    const poIds = new Set(buildPurchaseOrderRows().map(po => po.id))
    const invs = buildInvoiceRows()

    expect(invs.length).toBeGreaterThan(0)
    invs.forEach(inv => {
      expect(poIds.has(inv.purchaseOrderId)).toBe(true)
    })
  })

  it('gives every flag a seeded comparison run whose counts match what it produced', () => {
    const runs = buildComparisonRunRows()
    const flags = buildDiscrepancyFlagRows()
    const runIds = new Set(runs.map(r => r.id))

    flags.forEach(f => expect(runIds.has(f.comparisonRunId as string)).toBe(true))
    // Scoped to succeeded runs, which is what the claim was always about. An
    // abandoned run wrote no flags and counted none — its flagCount is null,
    // not zero, because nothing ever looked.
    runs
      .filter(run => run.status === 'succeeded')
      .forEach(run => {
        const own = flags.filter(f => f.comparisonRunId === run.id)
        expect(run.flagCount).toBe(own.length)
      })
    runs
      .filter(run => run.status === 'failed')
      .forEach(run => {
        expect(flags.some(f => f.comparisonRunId === run.id)).toBe(false)
        expect(run.flagCount).toBeNull()
        expect(run.lastError).toMatch(/^Comparison did not finish\. Reference: [0-9a-f]{8}$/)
      })
  })

  // Every delta reads the same way — positive means "more than it should be" —
  // but each type measures against the number IT disputes, which is not always
  // the PO. The seed used the invoice-minus-PO convention while the engine used
  // the inverse until S1; this pins the seed to what the engine now writes
  // (`toFlagValues` in apps/api/src/procurement/comparison.service.ts).
  it('states each delta against the value that flag type disputes', () => {
    buildDiscrepancyFlagRows().forEach(flag => {
      // POLICY v1 #4 and #6: the needs-review types compute none at all.
      if (flag.delta === null) return
      const po = flag.poValue === null ? 0 : Number(flag.poValue)
      const invoice = flag.invoiceValue === null ? 0 : Number(flag.invoiceValue)
      const received = flag.receivedValue === null ? 0 : Number(flag.receivedValue)

      const expected =
        flag.flagType === 'short_receipt'
          ? // What arrived against what was ordered: negative means short.
            received - po
          : flag.flagType === 'invoice_exceeds_received'
            ? // What was billed against what was kept: positive means billed
              // for more than we have.
              invoice - received
            : invoice - po
      expect(Number(flag.delta)).toBeCloseTo(expected, 6)
    })
  })

  it('gives line items provenance that matches their source kind', () => {
    const lines = [...buildPoLineItemRows(), ...buildInvoiceLineItemRows()]
    expect(lines.length).toBeGreaterThan(0)

    lines.forEach(line => {
      if (line.sourceKind === 'pdf-extraction') {
        // A PDF has no spreadsheet coordinates, but does carry model confidence.
        expect(line.sourceRow).toBeNull()
        expect(line.uom).toBeNull()
        expect(Number(line.extractionConfidence)).toBeGreaterThanOrEqual(0)
        expect(Number(line.extractionConfidence)).toBeLessThanOrEqual(1)
        expect(line.extractorVersion).toBeTruthy()
      } else {
        expect(typeof line.sourceRow).toBe('number')
        expect(String(line.uom).length).toBeLessThanOrEqual(20)
        expect(line.extractionConfidence).toBeNull()
        expect(line.extractorVersion).toBeNull()
      }
    })
  })

  // All eight since S6. A demo that only ever shows the original four teaches
  // the reader that receiving and needs-review do not exist.
  it('covers all eight discrepancy types with real line-item references', () => {
    const flags = buildDiscrepancyFlagRows()
    expect(new Set(flags.map(f => f.flagType))).toEqual(
      new Set([
        'quantity_mismatch',
        'price_mismatch',
        'missing_on_invoice',
        'missing_on_po',
        'short_receipt',
        'invoice_exceeds_received',
        'uom_mismatch',
        'currency_mismatch',
      ]),
    )
    const poLineIds = new Set(poLines.map(l => l.id))
    const invoiceLineIds = new Set(invoiceLines.map(l => l.id))
    flags.forEach(f => {
      if (f.poLineItemId) expect(poLineIds.has(f.poLineItemId as string)).toBe(true)
      if (f.invoiceLineItemId) expect(invoiceLineIds.has(f.invoiceLineItemId as string)).toBe(true)
      expect(f.status).toBe('open')
    })
  })

  // POLICY v1 #4 and #6: neither needs-review type computes a difference, and
  // that absent delta is the mechanical mark of "a human has to look".
  it('computes no delta for the needs-review flag types', () => {
    buildDiscrepancyFlagRows()
      .filter(f => f.flagType === 'uom_mismatch' || f.flagType === 'currency_mismatch')
      .forEach(f => expect(f.delta).toBeNull())
  })

  it('records every comparison run as three_way against the receipts it read', () => {
    const runs = buildComparisonRunRows()
    const receipts = buildGoodsReceiptRows()
    const links = buildComparisonRunGoodsReceiptRows()
    const runIds = new Set(runs.map(r => r.id))
    const receiptIds = new Set(receipts.map(r => r.id))

    // Every seeded PO has at least one receipt, so no run can honestly claim
    // two_way — and a three_way run with no linked receipt is the false claim
    // §7.4 forbids.
    // Succeeded runs only: the link rows are written in the same transaction
    // that writes the flags, so a run that died before it never recorded any.
    runs
      .filter(run => run.status === 'succeeded')
      .forEach(run => {
        expect(run.mode).toBe('three_way')
        expect(typeof run.goodsReceiptLineCount).toBe('number')
        expect(links.some(link => link.comparisonRunId === run.id)).toBe(true)
      })

    links.forEach(link => {
      expect(runIds.has(link.comparisonRunId)).toBe(true)
      expect(receiptIds.has(link.goodsReceiptId)).toBe(true)
    })
    // Composite primary key: a receipt is linked to a run at most once.
    expect(new Set(links.map(l => `${l.comparisonRunId}:${l.goodsReceiptId}`)).size).toBe(links.length)
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
