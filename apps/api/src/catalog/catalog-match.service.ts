import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm'
import { createLimit } from '@repo/ai'
import { catalogItems, catalogMatches, catalogs, db, invoiceLineItems, poLineItems, vendors } from '@repo/db'
import { StorageService } from '../storage/storage.service'
import { CatalogExtractionService } from './catalog-extraction.service'

// Both caps bound paid vision calls, so a malformed env var must never widen
// them: Number('') is 0 and Number('abc') is NaN, and NaN silently disables
// .limit() and the concurrency limiter alike. Fall back to the default.
function positiveIntEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function maxCandidates(): number {
  return positiveIntEnv('CATALOG_MATCH_MAX_CANDIDATES', 8)
}

// Each candidate is a vision-model call; at most this many run at once per
// search so one request cannot fan out the whole candidate cap in parallel.
function matchConcurrency(): number {
  return positiveIntEnv('CATALOG_MATCH_CONCURRENCY', 3)
}

// `%` and `_` are LIKE wildcards. A SKU such as `A%1` would otherwise match
// `AZZZ1` and, at the extreme, a lone `%` would match the whole catalog and
// send `CATALOG_MATCH_MAX_CANDIDATES` unrelated items to the vision model.
// Postgres LIKE takes backslash as its default escape character.
function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

type QueryLineItem = { id: string; workspaceId: string; sku: string | null; description: string | null }

type SearchInput = { purchaseOrderLineItemId?: string; invoiceLineItemId?: string; vendorId?: string }

// Mirrors ComparisonService's shape (load -> do work -> delete-prior-then-
// insert idempotency -> list/dismiss) but the "work" is a vision-LLM
// comparator per candidate instead of a DuckDB SQL join — A3 uses no
// DuckDB. matchType is derived from the presence of vendorId: sourcing
// (all vendors) when absent, compliance (one vendor) when present — same
// primitive, per the A3 plan's decision #2.
@Injectable()
export class CatalogMatchService {
  private readonly logger = new Logger(CatalogMatchService.name)

  constructor(
    private readonly storage: StorageService,
    private readonly extraction: CatalogExtractionService,
  ) {}

  async search(workspaceId: string, input: SearchInput) {
    const query = await this.loadQueryLineItem(workspaceId, input)
    if (input.vendorId) {
      await this.assertVendorInWorkspace(workspaceId, input.vendorId)
    }
    const queryText = this.lineItemText(query)
    const candidates = await this.findCandidates(workspaceId, query, input.vendorId)

    const limit = createLimit(matchConcurrency())
    const judged = await Promise.all(
      candidates.map((candidate) =>
        limit(async () => {
          const candidateText = this.lineItemText(candidate)
          const image = candidate.photoStorageKey ? await this.loadImage(candidate.photoStorageKey) : null

          const verdict = await this.extraction.compare(
            {
              queryText,
              candidateText,
              candidateImageBase64: image?.base64 ?? null,
              candidateImageContentType: image?.contentType ?? null,
            },
            workspaceId,
          )
          return { candidate, verdict }
        }),
      ),
    )

    const matchType = input.vendorId ? ('compliance' as const) : ('sourcing' as const)

    // Nothing to replace with, so replace nothing. A zero-candidate search
    // means the prefilter found no comparable items; wiping the line's prior
    // verdicts on the strength of that would destroy real work (and used to).
    if (judged.length === 0) {
      return { matches: [] }
    }

    // The delete is scoped exactly as narrowly as the insert that follows it:
    //  - status 'open' only, so a dismissal a user made survives a re-search;
    //  - same matchType, so verifying one vendor cannot wipe sourcing results;
    //  - same vendor on a compliance run, so vendor A's verify leaves B alone.
    // Both statements run in one transaction, so a failed insert can no longer
    // leave the line with no matches at all (same fix as S0a's ComparisonService).
    const queryPredicate = input.purchaseOrderLineItemId
      ? eq(catalogMatches.queryPoLineItemId, input.purchaseOrderLineItemId)
      : eq(catalogMatches.queryInvoiceLineItemId, input.invoiceLineItemId as string)

    const scope = [
      eq(catalogMatches.workspaceId, workspaceId),
      queryPredicate,
      eq(catalogMatches.status, 'open'),
      eq(catalogMatches.matchType, matchType),
    ]
    if (input.vendorId) {
      scope.push(eq(catalogMatches.vendorId, input.vendorId))
    }

    const inserted = await db.transaction(async (tx) => {
      await tx.delete(catalogMatches).where(and(...scope))

      return tx
        .insert(catalogMatches)
        .values(
          judged.map(({ candidate, verdict }) => ({
            workspaceId,
            matchType,
            queryPoLineItemId: input.purchaseOrderLineItemId ?? null,
            queryInvoiceLineItemId: input.invoiceLineItemId ?? null,
            catalogItemId: candidate.id,
            vendorId: candidate.vendorId,
            score: verdict.score !== null ? String(verdict.score) : null,
            isMatch: verdict.isMatch,
            reason: verdict.reason,
          })),
        )
        .returning()
    })

    return { matches: inserted }
  }

  async listMatches(
    workspaceId: string,
    filters: {
      vendorId?: string
      status?: 'open' | 'dismissed'
      poLineItemId?: string
      invoiceLineItemId?: string
    },
  ) {
    const conditions = [eq(catalogMatches.workspaceId, workspaceId)]
    if (filters.vendorId) {
      conditions.push(eq(catalogMatches.vendorId, filters.vendorId))
    }
    if (filters.status) {
      conditions.push(eq(catalogMatches.status, filters.status))
    }
    if (filters.poLineItemId) {
      conditions.push(eq(catalogMatches.queryPoLineItemId, filters.poLineItemId))
    }
    if (filters.invoiceLineItemId) {
      conditions.push(eq(catalogMatches.queryInvoiceLineItemId, filters.invoiceLineItemId))
    }

    const matches = await db
      .select()
      .from(catalogMatches)
      .where(and(...conditions))
      .orderBy(desc(catalogMatches.createdAt))

    return this.resolveMatchDetails(workspaceId, matches)
  }

  /**
   * Attaches the sku/description/photo of the catalog item and of the queried
   * PO or invoice line to each match. Without this the UI can only render
   * truncated ids, because a match row stores nothing but foreign keys.
   * Resolved in three batched queries rather than one per row.
   */
  private async resolveMatchDetails(workspaceId: string, matches: (typeof catalogMatches.$inferSelect)[]) {
    if (matches.length === 0) {
      return []
    }

    const itemIds = [...new Set(matches.map(m => m.catalogItemId))]
    const poIds = [...new Set(matches.map(m => m.queryPoLineItemId).filter((id): id is string => id !== null))]
    const invoiceIds = [
      ...new Set(matches.map(m => m.queryInvoiceLineItemId).filter((id): id is string => id !== null)),
    ]

    const [items, poLines, invoiceLines] = await Promise.all([
      db
        .select({
          id: catalogItems.id,
          sku: catalogItems.sku,
          description: catalogItems.description,
          photoStorageKey: catalogItems.photoStorageKey,
        })
        .from(catalogItems)
        .where(and(eq(catalogItems.workspaceId, workspaceId), inArray(catalogItems.id, itemIds))),
      poIds.length
        ? db
            .select({ id: poLineItems.id, sku: poLineItems.sku, description: poLineItems.description })
            .from(poLineItems)
            .where(and(eq(poLineItems.workspaceId, workspaceId), inArray(poLineItems.id, poIds)))
        : Promise.resolve([]),
      invoiceIds.length
        ? db
            .select({ id: invoiceLineItems.id, sku: invoiceLineItems.sku, description: invoiceLineItems.description })
            .from(invoiceLineItems)
            .where(and(eq(invoiceLineItems.workspaceId, workspaceId), inArray(invoiceLineItems.id, invoiceIds)))
        : Promise.resolve([]),
    ])

    const itemById = new Map(items.map(item => [item.id, item]))
    const queryById = new Map([...poLines, ...invoiceLines].map(line => [line.id, line]))

    return matches.map(match => ({
      ...match,
      catalogItem: itemById.get(match.catalogItemId) ?? null,
      queryItem: queryById.get(match.queryPoLineItemId ?? match.queryInvoiceLineItemId ?? '') ?? null,
    }))
  }

  async dismissMatch(workspaceId: string, matchId: string, userId: string) {
    const [match] = await db.select().from(catalogMatches).where(eq(catalogMatches.id, matchId)).limit(1)

    if (!match || match.workspaceId !== workspaceId) {
      throw new NotFoundException('Catalog match not found')
    }

    const [updated] = await db
      .update(catalogMatches)
      .set({ status: 'dismissed', dismissedAt: new Date(), dismissedBy: userId })
      .where(eq(catalogMatches.id, matchId))
      .returning()

    return updated
  }

  private async loadQueryLineItem(workspaceId: string, input: SearchInput): Promise<QueryLineItem> {
    if (input.purchaseOrderLineItemId && input.invoiceLineItemId) {
      throw new BadRequestException('Provide only one of purchaseOrderLineItemId or invoiceLineItemId')
    }

    if (input.purchaseOrderLineItemId) {
      const [row] = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.id, input.purchaseOrderLineItemId))
        .limit(1)
      if (!row || row.workspaceId !== workspaceId) {
        throw new NotFoundException('Purchase order line item not found')
      }
      return row
    }

    if (input.invoiceLineItemId) {
      const [row] = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.id, input.invoiceLineItemId)).limit(1)
      if (!row || row.workspaceId !== workspaceId) {
        throw new NotFoundException('Invoice line item not found')
      }
      return row
    }

    throw new BadRequestException('purchaseOrderLineItemId or invoiceLineItemId is required')
  }

  // The verify route takes vendorId from the URL, so an unowned or unknown id
  // must 404 rather than quietly matching nothing: `findCandidates` joins on
  // it, so a foreign vendor produced zero candidates and an empty success.
  // Mirrors CatalogDocumentsService's assertVendorInWorkspace, which is
  // private there — duplicated rather than injecting that whole service for
  // one guard and changing this constructor.
  private async assertVendorInWorkspace(workspaceId: string, vendorId: string) {
    const [vendor] = await db
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.workspaceId, workspaceId)))
      .limit(1)

    if (!vendor) {
      throw new NotFoundException('Vendor not found')
    }
  }

  private async findCandidates(workspaceId: string, query: QueryLineItem, vendorId?: string) {
    const cap = maxCandidates()
    const term = (query.sku ?? query.description ?? '').trim()

    // A line with no SKU and no description has nothing to match on. Falling
    // through without a text filter used to hand an arbitrary `cap` slice of
    // the whole workspace catalog to the vision model — pure spend, no signal.
    if (!term) {
      return []
    }

    const escaped = escapeLikeLiteral(term)
    const conditions = [eq(catalogItems.workspaceId, workspaceId)]
    if (vendorId) {
      conditions.push(eq(catalogs.vendorId, vendorId))
    }
    const textFilter = or(ilike(catalogItems.sku, `%${escaped}%`), ilike(catalogItems.description, `%${escaped}%`))
    if (textFilter) {
      conditions.push(textFilter)
    }

    const rows = await db
      .select({
        id: catalogItems.id,
        sku: catalogItems.sku,
        description: catalogItems.description,
        photoStorageKey: catalogItems.photoStorageKey,
        vendorId: catalogs.vendorId,
      })
      .from(catalogItems)
      .innerJoin(catalogs, eq(catalogItems.catalogId, catalogs.id))
      .where(and(...conditions))
      // Without an ORDER BY the cap keeps an arbitrary subset, so two
      // identical searches could judge different candidates and disagree.
      .orderBy(catalogItems.createdAt, catalogItems.id)
      .limit(cap + 1)

    if (rows.length > cap) {
      this.logger.warn(`Catalog match candidate prefilter truncated at cap=${cap} workspaceId=${workspaceId}`)
    }

    return rows.slice(0, cap)
  }

  // Returns the stored Content-Type alongside the bytes so the vision call can
  // label the data URL truthfully instead of calling every image a PNG.
  private async loadImage(storageKey: string): Promise<{ base64: string; contentType: string | null } | null> {
    try {
      const { buffer, contentType } = await this.storage.getObject(storageKey)
      return { base64: buffer.toString('base64'), contentType }
    } catch (error) {
      this.logger.warn(
        `Catalog match failed to load candidate image key=${storageKey}: ${error instanceof Error ? error.message : String(error)}`,
      )
      return null
    }
  }

  private lineItemText(item: { sku: string | null; description: string | null }) {
    return [item.sku ? `SKU: ${item.sku}` : null, item.description ? `Description: ${item.description}` : null]
      .filter(Boolean)
      .join('\n')
  }
}
