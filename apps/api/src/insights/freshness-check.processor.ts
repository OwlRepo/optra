import { Injectable, Logger } from '@nestjs/common'
import { Process, Processor } from '@nestjs/bull'
import { Job } from 'bull'
import { db, documentReviewFlags } from '@repo/db'
import { BackgroundRunsService } from './background-runs.service'
import { TicketDocCoverageService } from './ticket-doc-coverage.service'
import { supportSurfacesEnabled } from './support-surfaces-flag'

@Injectable()
@Processor('freshness-check-queue')
export class FreshnessCheckProcessor {
  private readonly logger = new Logger(FreshnessCheckProcessor.name)

  constructor(
    private readonly coverage: TicketDocCoverageService,
    private readonly runs: BackgroundRunsService,
  ) {}

  @Process()
  async onCheck(job: Job<{ workspaceId: string }>) {
    const { workspaceId } = job.data
    // A job queued before the flag went off (or a retry) ends here, with no run
    // row and no flag written.
    if (!supportSurfacesEnabled()) {
      this.logger.log(`Freshness check skipped workspaceId=${workspaceId}: support surfaces are off`)
      return
    }
    const runId = await this.runs.start('freshness-check', workspaceId)

    try {
      const gaps = await this.coverage.findGaps(workspaceId)

      if (gaps.length > 0) {
        await db.insert(documentReviewFlags).values(
          gaps.map((gap) => ({
            workspaceId,
            documentId: gap.documentId,
            ticketId: gap.ticketId,
            score: gap.score,
            reason: 'ticket-mismatch',
          })),
        )
      }

      await this.runs.succeed(runId, { flagsCreated: gaps.length })
      this.logger.log(`Freshness check workspaceId=${workspaceId} flagsCreated=${gaps.length}`)
    } catch (error) {
      await this.runs.fail(runId, error)
      this.logger.error(
        `Freshness check failed workspaceId=${workspaceId}: ${error instanceof Error ? error.message : String(error)}`,
      )
      throw error
    }
  }
}
