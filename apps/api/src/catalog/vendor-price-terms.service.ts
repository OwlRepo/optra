import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db, vendorPriceTerms, vendors } from '@repo/db'
import { CreatePriceTermDto } from './dto/create-price-term.dto'

/**
 * The only writer of `vendor_price_terms`.
 *
 * "At most one open-ended term per vendor, item, unit and currency" is enforced
 * here rather than by a unique index, and that is not a shortcut. A partial
 * unique index is unavailable: drizzle-kit 0.20 accepts `.where()` on the index
 * builder and then drops it when generating the migration, emitting a FULL
 * unique index — which would reject every superseded row this table exists to
 * keep. The schema comment carries the evidence.
 *
 * So supersession happens in one transaction: close the open term, then insert
 * the new one pointing back at it. Nothing is ever updated except that closing
 * `effective_to`, and nothing is ever deleted.
 */
@Injectable()
export class VendorPriceTermsService {
  async create(workspaceId: string, vendorId: string, dto: CreatePriceTermDto, userId: string) {
    await this.assertVendorInWorkspace(workspaceId, vendorId)

    const sku = dto.sku.trim()
    const skuKey = sku.toLowerCase()
    const uom = dto.uom?.trim() || null
    const currency = dto.currency.toUpperCase()
    const effectiveFrom = new Date(dto.effectiveFrom)

    return db.transaction(async (tx) => {
      // The unit is compared case-folded, the way the comparison engine folds
      // it, so "Each" does not open a second agreement beside "each". The
      // stored value keeps whatever the human typed.
      const [open] = await tx
        .select()
        .from(vendorPriceTerms)
        .where(
          and(
            eq(vendorPriceTerms.workspaceId, workspaceId),
            eq(vendorPriceTerms.vendorId, vendorId),
            eq(vendorPriceTerms.skuKey, skuKey),
            eq(vendorPriceTerms.currency, currency),
            sql`lower(coalesce(${vendorPriceTerms.uom}, '')) = ${uom ? uom.toLowerCase() : ''}`,
            isNull(vendorPriceTerms.effectiveTo),
          ),
        )
        .limit(1)

      if (open && open.effectiveFrom >= effectiveFrom) {
        // Backdating behind a price that is already live would leave two terms
        // covering the same instant with no way to choose between them, which
        // is the one thing applicability must never have to guess at.
        throw new BadRequestException(
          'A price for this item is already effective from that date or later. Record the new price from a later date',
        )
      }

      if (open) {
        // Half-open [from, to): the old window ends exactly where the new one
        // begins, so no instant is covered twice and none is left uncovered.
        await tx
          .update(vendorPriceTerms)
          .set({ effectiveTo: effectiveFrom, updatedAt: new Date() })
          .where(eq(vendorPriceTerms.id, open.id))
      }

      const [term] = await tx
        .insert(vendorPriceTerms)
        .values({
          workspaceId,
          vendorId,
          sku,
          skuKey,
          uom,
          unitPrice: dto.unitPrice,
          currency,
          effectiveFrom,
          effectiveTo: null,
          sourceReference: dto.sourceReference ?? null,
          supersedesId: open?.id ?? null,
          createdBy: userId,
        })
        .returning()

      return term
    })
  }

  async list(workspaceId: string, vendorId: string) {
    await this.assertVendorInWorkspace(workspaceId, vendorId)

    return db
      .select()
      .from(vendorPriceTerms)
      .where(and(eq(vendorPriceTerms.workspaceId, workspaceId), eq(vendorPriceTerms.vendorId, vendorId)))
      .orderBy(desc(vendorPriceTerms.effectiveFrom), desc(vendorPriceTerms.id))
  }

  /**
   * Scoped on the row, never on the id alone — a caller supplying another
   * workspace's vendor gets 404 rather than 403, so the route cannot be used to
   * probe which vendor ids exist elsewhere. Mirrors the same private guard in
   * `CatalogDocumentsService`; kept local rather than lifted into a shared
   * helper, which would be a refactor this slice did not ask for.
   */
  private async assertVendorInWorkspace(workspaceId: string, vendorId: string) {
    const [vendor] = await db
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.workspaceId, workspaceId)))
      .limit(1)

    if (!vendor) throw new NotFoundException('Vendor not found')
    return vendor
  }
}
