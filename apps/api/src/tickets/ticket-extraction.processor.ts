import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { Job } from 'bull'
import { db, tickets } from '@repo/db'
import { and, eq, inArray } from 'drizzle-orm'
import { extractTicketFromTranscript } from '@repo/ai'
import { EventsService } from '../events/events.service'

@Processor('ticket-extraction-queue')
export class TicketExtractionProcessor {
  private readonly logger = new Logger(TicketExtractionProcessor.name)

  constructor(private readonly events: EventsService) {}

  @Process()
  async handleExtraction(job: Job<{ ticketId: string }>) {
    const { ticketId } = job.data
    const processingStartedAt = new Date()

    const started = await db
      .update(tickets)
      .set({
        status: 'processing',
        processingStartedAt,
        lastError: null,
        updatedAt: processingStartedAt,
      })
      .where(and(eq(tickets.id, ticketId), eq(tickets.status, 'pending')))
      .returning({ id: tickets.id })

    if (started.length === 0) {
      this.logger.warn(`Ticket extraction skipped ticketId=${ticketId}: row no longer pending`)
      return
    }

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1)
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`)
    }

    try {
      const extracted = await extractTicketFromTranscript(ticket.transcript)
      const rows = await db
        .update(tickets)
        .set({
          ...extracted,
          // V2 F2: category is deterministically copied from the already-
          // extracted productArea, not a separate LLM extraction target —
          // keeps the extraction prompt/chain untouched.
          category: extracted.productArea,
          status: 'done',
          lastError: null,
          updatedAt: new Date(),
        })
        .where(and(eq(tickets.id, ticketId), inArray(tickets.status, ['pending', 'processing'])))
        .returning({ id: tickets.id })
      if (rows.length === 0) {
        this.logger.warn(`Ticket extraction completion skipped ticketId=${ticketId}: row already terminal`)
      } else {
        await this.events
          .record(ticket.workspaceId, 'ticket_extracted', ticketId, extracted.title ?? 'Ticket draft')
          .catch((err: unknown) => {
            this.logger.warn(
              `Event record failed ticketId=${ticketId}: ${err instanceof Error ? err.message : String(err)}`,
            )
          })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(
        `Ticket extraction failed ticketId=${ticketId}`,
        error instanceof Error ? error.stack : message,
      )
      await db
        .update(tickets)
        .set({
          status: 'failed',
          lastError: message,
          updatedAt: new Date(),
        })
        .where(eq(tickets.id, ticketId))
      await this.events
        .record(ticket.workspaceId, 'ticket_failed', ticketId, ticket.title ?? 'Ticket draft', message)
        .catch((err: unknown) => {
          this.logger.warn(
            `Event record failed ticketId=${ticketId}: ${err instanceof Error ? err.message : String(err)}`,
          )
        })
    }
  }
}
