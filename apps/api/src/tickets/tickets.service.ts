import { createHash } from 'crypto'
import { getQueueToken, InjectQueue } from '@nestjs/bull'
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { Job, Queue } from 'bull'
import { and, desc, eq, lt, or, sql } from 'drizzle-orm'
import {
  db,
  decodeCursor,
  encodeCursor,
  type TicketFieldConfidence,
  tickets,
} from '@repo/db'
import { syncTicketChunk } from '@repo/ai'
import { ListQueryDto } from '../common/dto/list-query.dto'
import type { UpdateTicketDto } from './dto/update-ticket.dto'

const PENDING_TICKET_STALE_MS = 10 * 60_000
const PROCESSING_TICKET_STALE_MS = 30 * 60_000
const TICKET_JOB_TIMEOUT_MS = 5 * 60_000

const ticketDetailSelect = {
  id: tickets.id,
  transcript: tickets.transcript,
  title: tickets.title,
  issueSummary: tickets.issueSummary,
  reproSteps: tickets.reproSteps,
  severity: tickets.severity,
  productArea: tickets.productArea,
  hypothesizedRootCause: tickets.hypothesizedRootCause,
  nextAction: tickets.nextAction,
  status: tickets.status,
  lastError: tickets.lastError,
  fieldConfidence: tickets.fieldConfidence,
  usefulness: tickets.usefulness,
  editState: tickets.editState,
  feedbackNote: tickets.feedbackNote,
  reviewedBy: tickets.reviewedBy,
  reviewedAt: tickets.reviewedAt,
  createdAt: tickets.createdAt,
  updatedAt: tickets.updatedAt,
}

@Injectable()
export class TicketsService implements OnModuleInit {
  private readonly logger = new Logger(TicketsService.name)

  constructor(
    @InjectQueue('ticket-extraction-queue') private readonly ticketQueue: Queue,
  ) {}

  async onModuleInit() {
    this.registerQueueLogging()
    await this.reconcileTickets().catch((error: unknown) => {
      this.logger.error(
        `Failed to reconcile ticket queue: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      )
    })
  }

  async create(workspaceId: string, transcript: string) {
    const normalizedTranscript = transcript.trim()
    const transcriptHash = createHash('sha256').update(normalizedTranscript).digest('hex')
    const existing = await this.findExistingTicketByHash(workspaceId, transcriptHash)
    if (existing) {
      return { statusCode: 200, ticket: this.toCreateResponse(existing) }
    }

    let ticketId: string

    try {
      const [created] = await db
        .insert(tickets)
        .values({
          workspaceId,
          transcript: normalizedTranscript,
          transcriptHash,
          status: 'pending',
          productArea: 'general',
          fieldConfidence: {},
        })
        .returning()
      ticketId = created.id
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existingAfterRace = await this.findExistingTicketByHash(workspaceId, transcriptHash)
        if (existingAfterRace) {
          return { statusCode: 200, ticket: this.toCreateResponse(existingAfterRace) }
        }
      }

      throw new InternalServerErrorException(
        `Failed to create ticket: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    try {
      await this.queueTicket(ticketId)
    } catch (error) {
      throw error
    }

    const [created] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1)
    return { statusCode: 202, ticket: this.toCreateResponse(created) }
  }

  async list(
    workspaceId: string,
    query: Pick<ListQueryDto, 'cursor' | 'limit'> = {},
  ) {
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100)
    const cursor = query.cursor ? decodeCursor(query.cursor) : null
    const updatedAtUs = sql<number>`floor(extract(epoch from ${tickets.updatedAt}) * 1000000)`
    const createdAtUs = sql<number>`floor(extract(epoch from ${tickets.createdAt}) * 1000000)`

    const rows = await db
      .select({
        id: tickets.id,
        title: tickets.title,
        status: tickets.status,
        severity: tickets.severity,
        createdAt: tickets.createdAt,
        updatedAt: tickets.updatedAt,
        updatedCursor: updatedAtUs,
        createdCursor: createdAtUs,
      })
      .from(tickets)
      .where(
        and(
          eq(tickets.workspaceId, workspaceId),
          cursor
            ? or(
                lt(updatedAtUs, Number(cursor.k[0])),
                and(
                  eq(updatedAtUs, Number(cursor.k[0])),
                  lt(createdAtUs, Number(cursor.k[1])),
                ),
                and(
                  eq(updatedAtUs, Number(cursor.k[0])),
                  eq(createdAtUs, Number(cursor.k[1])),
                  lt(tickets.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(updatedAtUs), desc(createdAtUs), desc(tickets.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = rows
      .slice(0, limit)
      .map(({ updatedCursor: _updatedCursor, createdCursor: _createdCursor, ...ticket }) => ticket)
    const last = items.at(-1)
    const lastRow = rows.at(Math.min(limit, rows.length) - 1)

    return {
      items,
      nextCursor:
        hasMore && last && lastRow
          ? encodeCursor({
              k: [lastRow.updatedCursor, lastRow.createdCursor],
              id: last.id,
            })
          : null,
    }
  }

  async getOne(workspaceId: string, ticketId: string) {
    const [ticket] = await db
      .select(ticketDetailSelect)
      .from(tickets)
      .where(and(eq(tickets.workspaceId, workspaceId), eq(tickets.id, ticketId)))
      .limit(1)

    if (!ticket) {
      throw new NotFoundException('Ticket not found')
    }

    return ticket
  }

  async update(workspaceId: string, ticketId: string, reviewedBy: string, dto: UpdateTicketDto) {
    const existing = await this.getOne(workspaceId, ticketId)
    const nextConfidence = this.mergeFieldConfidence(existing.fieldConfidence ?? {}, dto)

    const [updated] = await db
      .update(tickets)
      .set({
        ...this.pickEditableFields(dto),
        fieldConfidence: nextConfidence,
        reviewedBy,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(tickets.workspaceId, workspaceId), eq(tickets.id, ticketId)))
      .returning()

    if (!updated) {
      throw new NotFoundException('Ticket not found')
    }

    const shouldSyncTicketChunk =
      updated.status === 'done' &&
      (
        (updated.reviewedBy !== null && updated.usefulness === 'useful') ||
        existing.usefulness === 'useful' ||
        existing.reviewedBy !== null
      )

    if (shouldSyncTicketChunk) {
      await syncTicketChunk(updated).catch((err: unknown) => {
        this.logger.warn(
          `Ticket chunk sync failed ticketId=${ticketId}: ${err instanceof Error ? err.message : String(err)}`,
        )
      })
    }

    return updated
  }

  async queueTicket(ticketId: string) {
    const jobId = this.getJobId(ticketId)
    const enqueuedAt = new Date()

    await db
      .update(tickets)
      .set({
        status: 'pending',
        queueJobId: jobId,
        enqueuedAt,
        processingStartedAt: null,
        lastError: null,
        updatedAt: enqueuedAt,
      })
      .where(eq(tickets.id, ticketId))

    try {
      await this.ticketQueue.add(
        { ticketId },
        {
          jobId,
          attempts: 1,
          timeout: TICKET_JOB_TIMEOUT_MS,
          removeOnComplete: true,
          removeOnFail: false,
        },
      )
      return { queued: true, ticketId, jobId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await db
        .update(tickets)
        .set({
          status: 'failed',
          lastError: `Queue enqueue failed: ${message}`,
          updatedAt: new Date(),
        })
        .where(eq(tickets.id, ticketId))
      this.logger.error(`Ticket enqueue failed ticketId=${ticketId} jobId=${jobId}: ${message}`)
      throw error
    }
  }

  async reconcileTickets(now = new Date()) {
    const rows = await db
      .select()
      .from(tickets)
      .where(or(eq(tickets.status, 'pending'), eq(tickets.status, 'processing')))

    for (const row of rows) {
      const threshold = row.status === 'processing' ? PROCESSING_TICKET_STALE_MS : PENDING_TICKET_STALE_MS
      const referenceTime =
        row.status === 'processing'
          ? row.processingStartedAt ?? row.enqueuedAt ?? row.updatedAt ?? row.createdAt
          : row.enqueuedAt ?? row.updatedAt ?? row.createdAt

      if (!referenceTime || now.getTime() - referenceTime.getTime() < threshold) {
        continue
      }

      const job = row.queueJobId ? await this.ticketQueue.getJob(row.queueJobId).catch(() => null) : null
      if (job) {
        continue
      }

      await db
        .update(tickets)
        .set({
          status: 'failed',
          lastError: `Queue reconciliation marked ticket as failed: missing Bull job ${row.queueJobId ?? '(none)'} after ${row.status} grace period`,
          updatedAt: now,
        })
        .where(eq(tickets.id, row.id))
    }
  }

  private async findExistingTicketByHash(workspaceId: string, transcriptHash: string) {
    const [match] = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.workspaceId, workspaceId), eq(tickets.transcriptHash, transcriptHash)))
      .limit(1)

    if (!match) {
      return null
    }

    const [ticket] = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.workspaceId, workspaceId), eq(tickets.id, match.id)))
      .limit(1)

    return ticket ?? null
  }

  private isUniqueViolation(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
  }

  private toCreateResponse(ticket: typeof tickets.$inferSelect) {
    return {
      id: ticket.id,
      status: ticket.status,
      title: ticket.title,
    }
  }

  private getJobId(ticketId: string) {
    return `ticket-extraction:${ticketId}`
  }

  private pickEditableFields(dto: UpdateTicketDto) {
    return {
      title: dto.title,
      issueSummary: dto.issueSummary,
      reproSteps: dto.reproSteps,
      severity: dto.severity,
      productArea: dto.productArea?.trim().toLowerCase(),
      hypothesizedRootCause: dto.hypothesizedRootCause,
      nextAction: dto.nextAction,
      usefulness: dto.usefulness,
      editState: dto.editState,
      feedbackNote: dto.feedbackNote,
    }
  }

  private mergeFieldConfidence(current: TicketFieldConfidence, dto: UpdateTicketDto): TicketFieldConfidence {
    const next = { ...current }

    const editedFields: Array<keyof TicketFieldConfidence> = [
      'title',
      'issueSummary',
      'reproSteps',
      'severity',
      'productArea',
      'hypothesizedRootCause',
      'nextAction',
    ]

    for (const field of editedFields) {
      if (dto[field] !== undefined) {
        next[field] = this.scoreEditedField(dto[field])
      }
    }

    return next
  }

  private scoreEditedField(value: unknown) {
    if (typeof value === 'string') {
      const length = value.trim().length
      if (length === 0) return 0
      if (length >= 120) return 0.99
      if (length >= 40) return 0.95
      return 0.9
    }

    return value ? 0.95 : 0
  }

  private registerQueueLogging() {
    this.ticketQueue.on('active', (job: Job<{ ticketId: string }>) => {
      this.logger.log(`Ticket extraction active ticketId=${job.data.ticketId} jobId=${String(job.id)}`)
    })
    this.ticketQueue.on('completed', (job: Job<{ ticketId: string }>) => {
      this.logger.log(`Ticket extraction completed ticketId=${job.data.ticketId} jobId=${String(job.id)}`)
    })
    this.ticketQueue.on('failed', (job: Job<{ ticketId: string }>, error: Error) => {
      this.logger.warn(`Ticket extraction failed ticketId=${job.data.ticketId} jobId=${String(job.id)} error=${error.message}`)
    })
  }
}
