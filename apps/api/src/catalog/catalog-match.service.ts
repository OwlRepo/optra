import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { and, desc, eq, ilike, or } from 'drizzle-orm'
import { catalogItems, catalogMatches, catalogs, db, invoiceLineItems, poLineItems } from '@repo/db'
import { StorageService } from '../storage/storage.service'
import { CatalogExtractionService } from './catalog-extraction.service'

function maxCandidates(): number {
  return Number(process.env.CATALOG_MATCH_MAX_CANDIDATES ?? 8)
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
    const queryText = this.lineItemText(query)
    const candidates = await this.findCandidates(workspaceId, query, input.vendorId)

    const judged = await Promise.all(
      candidates.map(async (candidate) => {
        const candidateText = this.lineItemText(candidate)
        const candidateImageBase64 = candidate.photoStorageKey
          ? await this.loadImageBase64(candidate.photoStorageKey)
          : null

        const verdict = await this.extraction.compare({ queryText, candidateText, candidateImageBase64 })
        return { candidate, verdict }
      }),
    )

    const matchType = input.vendorId ? ('compliance' as const) : ('sourcing' as const)

    await db
      .delete(catalogMatches)
      .where(
        and(
          eq(catalogMatches.workspaceId, workspaceId),
          input.purchaseOrderLineItemId
            ? eq(catalogMatches.queryPoLineItemId, input.purchaseOrderLineItemId)
            : eq(catalogMatches.queryInvoiceLineItemId, input.invoiceLineItemId as string),
        ),
      )

    const inserted =
      judged.length > 0
        ? await db
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
        : []

    return { matches: inserted }
  }

  async listMatches(workspaceId: string, filters: { vendorId?: string; status?: 'open' | 'dismissed' }) {
    const conditions = [eq(catalogMatches.workspaceId, workspaceId)]
    if (filters.vendorId) {
      conditions.push(eq(catalogMatches.vendorId, filters.vendorId))
    }
    if (filters.status) {
      conditions.push(eq(catalogMatches.status, filters.status))
    }

    return db
      .select()
      .from(catalogMatches)
      .where(and(...conditions))
      .orderBy(desc(catalogMatches.createdAt))
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

  private async findCandidates(workspaceId: string, query: QueryLineItem, vendorId?: string) {
    const cap = maxCandidates()
    const term = (query.sku ?? query.description ?? '').trim()

    const conditions = [eq(catalogItems.workspaceId, workspaceId)]
    if (vendorId) {
      conditions.push(eq(catalogs.vendorId, vendorId))
    }
    if (term) {
      const textFilter = or(ilike(catalogItems.sku, `%${term}%`), ilike(catalogItems.description, `%${term}%`))
      if (textFilter) {
        conditions.push(textFilter)
      }
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
      .limit(cap + 1)

    if (rows.length > cap) {
      this.logger.warn(`Catalog match candidate prefilter truncated at cap=${cap} workspaceId=${workspaceId}`)
    }

    return rows.slice(0, cap)
  }

  private async loadImageBase64(storageKey: string): Promise<string | null> {
    try {
      const buffer = await this.storage.getBuffer(storageKey)
      return buffer.toString('base64')
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
