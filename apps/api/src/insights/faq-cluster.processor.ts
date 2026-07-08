import { Injectable, Logger } from '@nestjs/common'
import { Process, Processor } from '@nestjs/bull'
import { Job } from 'bull'
import { and, eq, inArray, or } from 'drizzle-orm'
import { db, faqDrafts, tickets } from '@repo/db'
import { BackgroundRunsService } from './background-runs.service'
import { TicketDocCoverageService } from './ticket-doc-coverage.service'
import { FaqClusterService } from './faq-cluster.service'

@Injectable()
@Processor('faq-cluster-queue')
export class FaqClusterProcessor {
  private readonly logger = new Logger(FaqClusterProcessor.name)

  constructor(
    private readonly coverage: TicketDocCoverageService,
    private readonly clusterer: FaqClusterService,
    private readonly runs: BackgroundRunsService,
  ) {}

  @Process()
  async onCluster(job: Job<{ workspaceId: string }>) {
    const { workspaceId } = job.data
    const runId = await this.runs.start('faq-cluster', workspaceId)

    try {
      const uncovered = await this.coverage.findUncoveredTickets(workspaceId)
      const alreadyDrafted = await this.alreadyDraftedTicketIds(workspaceId)
      const eligible = uncovered.filter((ticket) => !alreadyDrafted.has(ticket.ticketId))

      const clusters = this.clusterer.cluster(eligible)
      let draftsCreated = 0

      for (const ticketIds of clusters) {
        const created = await this.draftFromCluster(workspaceId, ticketIds)
        if (created) draftsCreated += 1
      }

      await this.runs.succeed(runId, { clustersFound: clusters.length, draftsCreated })
      this.logger.log(`FAQ cluster workspaceId=${workspaceId} draftsCreated=${draftsCreated}`)
    } catch (error) {
      await this.runs.fail(runId, error)
      this.logger.error(
        `FAQ cluster failed workspaceId=${workspaceId}: ${error instanceof Error ? error.message : String(error)}`,
      )
      throw error
    }
  }

  private async alreadyDraftedTicketIds(workspaceId: string): Promise<Set<string>> {
    const rows = await db
      .select({ ticketIds: faqDrafts.ticketIds })
      .from(faqDrafts)
      .where(and(eq(faqDrafts.workspaceId, workspaceId), or(eq(faqDrafts.status, 'pending'), eq(faqDrafts.status, 'approved'))))

    const seen = new Set<string>()
    for (const row of rows) {
      for (const ticketId of row.ticketIds) {
        seen.add(ticketId)
      }
    }
    return seen
  }

  private async draftFromCluster(workspaceId: string, ticketIds: string[]): Promise<boolean> {
    const { generateFaqDraft } = await import('@repo/ai')

    const rows = await db
      .select({ title: tickets.title, issueSummary: tickets.issueSummary, nextAction: tickets.nextAction })
      .from(tickets)
      .where(inArray(tickets.id, ticketIds))

    if (rows.length === 0) return false

    const draft = await generateFaqDraft(rows)

    await db.insert(faqDrafts).values({
      workspaceId,
      question: draft.question,
      answer: draft.answer,
      ticketIds,
      clusterSize: ticketIds.length,
      status: 'pending',
    })

    return true
  }
}
