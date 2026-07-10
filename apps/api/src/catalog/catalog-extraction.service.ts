import { Injectable } from '@nestjs/common'
import {
  CatalogItemExtractionResult,
  CompareLineItemResult,
  CompareLineItemToCatalogImageInput,
  compareLineItemToCatalogImage,
  extractCatalogItemsFromImage,
} from '@repo/ai'

// Thin wrapper over @repo/ai's catalog chains — exists purely as a Nest DI
// seam so the parse processor / match service unit specs and the e2e suite
// can override it (no real OpenAI call in tests), mirroring
// ProcurementExtractionService.
@Injectable()
export class CatalogExtractionService {
  async extractFromImage(pngBuffer: Buffer): Promise<CatalogItemExtractionResult> {
    return extractCatalogItemsFromImage(pngBuffer)
  }

  async compare(input: CompareLineItemToCatalogImageInput): Promise<CompareLineItemResult> {
    return compareLineItemToCatalogImage(input)
  }
}
