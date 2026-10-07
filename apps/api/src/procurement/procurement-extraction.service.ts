import { Injectable } from '@nestjs/common'
import {
  extractLineItemsFromImages,
  extractLineItemsFromPdf,
  ImagePage,
  ProcurementExtractionKind,
  ProcurementExtractionResult,
} from '@repo/ai'
import { UsageService } from '../limits/usage.service'

// Thin wrapper over @repo/ai's extraction chain — the Nest DI seam the
// processor's unit spec and the e2e suite override (no real OpenAI call in
// tests), and the one place procurement extraction is charged to the
// workspace token budget (CLAUDE.md: budget paths are never bypassed).
@Injectable()
export class ProcurementExtractionService {
  constructor(private readonly usage: UsageService) {}

  async extract(filePath: string, workspaceId: string): Promise<ProcurementExtractionResult> {
    return this.usage.metered(workspaceId, (meter) => extractLineItemsFromPdf(filePath, { meter }))
  }

  // Photo intake: same metering seam, so vision spend counts against the
  // workspace's monthly budget exactly like a PDF extraction.
  async extractFromImages(
    pages: ImagePage[],
    kind: ProcurementExtractionKind,
    workspaceId: string,
  ): Promise<ProcurementExtractionResult> {
    return this.usage.metered(workspaceId, (meter) => extractLineItemsFromImages(pages, kind, { meter }))
  }
}
