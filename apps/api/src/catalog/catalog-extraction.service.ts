import { Injectable } from '@nestjs/common'
import {
  CatalogItemExtractionResult,
  CompareLineItemResult,
  CompareLineItemToCatalogImageInput,
  compareLineItemToCatalogImage,
  extractCatalogItemsFromImage,
} from '@repo/ai'
import { UsageService } from '../limits/usage.service'

// Thin wrapper over @repo/ai's catalog chains — exists as a Nest DI seam so
// the parse processor / match service unit specs and the e2e suite can
// override it (no real OpenAI call in tests), mirroring
// ProcurementExtractionService. Every model call is charged to the workspace
// token budget here.
@Injectable()
export class CatalogExtractionService {
  constructor(private readonly usage: UsageService) {}

  async extractFromImage(pngBuffer: Buffer, workspaceId: string): Promise<CatalogItemExtractionResult> {
    return this.usage.metered(workspaceId, (meter) => extractCatalogItemsFromImage(pngBuffer, { meter }))
  }

  async compare(input: CompareLineItemToCatalogImageInput, workspaceId: string): Promise<CompareLineItemResult> {
    return this.usage.metered(workspaceId, (meter) => compareLineItemToCatalogImage({ ...input, meter }))
  }
}
