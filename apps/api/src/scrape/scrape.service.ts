import { InjectQueue } from '@nestjs/bull'
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bull'
import { and, count, desc, eq } from 'drizzle-orm'
import { db, documents, knowledgeBases, scrapeRuns } from '@repo/db'
import { ScrapeDto } from './dto/scrape.dto'

@Injectable()
export class ScrapeService {
  constructor(
    @InjectQueue('scrape-queue') private readonly scrapeQueue: Queue,
    private readonly config: ConfigService,
  ) {}

  async startScrape(workspaceId: string, kbId: string, dto: ScrapeDto) {
    await this.assertKbInWorkspace(workspaceId, kbId)

    const quotaRemaining = await this.quotaRemaining(workspaceId)
    if (quotaRemaining <= 0) {
      throw new ForbiddenException('Workspace document quota reached')
    }

    const maxDepth = dto.maxDepth ?? 3
    const maxPages = Math.min(dto.maxPages ?? 500, quotaRemaining)

    const [run] = await db
      .insert(scrapeRuns)
      .values({
        workspaceId,
        knowledgeBaseId: kbId,
        seedUrl: dto.url,
        status: 'queued',
        maxDepth,
        maxPages,
      })
      .returning()

    await this.scrapeQueue.add(
      {
        runId: run.id,
        workspaceId,
        knowledgeBaseId: kbId,
        url: dto.url,
        maxDepth,
        maxPages,
        includePrefixes: dto.includePrefixes,
      },
      {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      },
    )

    return { runId: run.id, status: run.status }
  }

  async listRuns(workspaceId: string, kbId: string) {
    await this.assertKbInWorkspace(workspaceId, kbId)

    return db
      .select()
      .from(scrapeRuns)
      .where(and(eq(scrapeRuns.workspaceId, workspaceId), eq(scrapeRuns.knowledgeBaseId, kbId)))
      .orderBy(desc(scrapeRuns.createdAt))
  }

  async quotaRemaining(workspaceId: string) {
    const cap = Number(this.config.get('MAX_DOCS_PER_WORKSPACE') ?? 5000)
    const [result] = await db
      .select({ count: count(documents.id) })
      .from(documents)
      .where(eq(documents.workspaceId, workspaceId))

    return cap - Number(result?.count ?? 0)
  }

  private async assertKbInWorkspace(workspaceId: string, kbId: string) {
    const [knowledgeBase] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId)).limit(1)

    if (!knowledgeBase || knowledgeBase.workspaceId !== workspaceId) {
      throw new NotFoundException('Knowledge base not found')
    }

    return knowledgeBase
  }
}
