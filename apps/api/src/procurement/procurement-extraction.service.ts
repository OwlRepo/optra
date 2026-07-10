import { Injectable } from '@nestjs/common'
import { extractLineItemsFromPdf, ProcurementExtractionResult } from '@repo/ai'

// Thin wrapper over @repo/ai's extraction chain — exists purely as a Nest DI
// seam so the processor's unit spec and the e2e suite can override it
// (no real OpenAI call in tests), mirroring how StorageService is overridden.
@Injectable()
export class ProcurementExtractionService {
  async extract(filePath: string): Promise<ProcurementExtractionResult> {
    return extractLineItemsFromPdf(filePath)
  }
}
