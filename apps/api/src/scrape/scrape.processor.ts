import { randomUUID } from 'crypto'
import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Job } from 'bull'
import { and, eq, sql } from 'drizzle-orm'
import { db, documents, scrapeRuns } from '@repo/db'
import { StorageService } from '../storage/storage.service'
import { IngestService } from '../ingest/ingest.service'

type ScrapeJob = {
  runId: string
  workspaceId: string
  knowledgeBaseId: string
  url: string
  maxDepth: number
  maxPages: number
  includePrefixes?: string[]
}

@Processor('scrape-queue')
export class ScrapeProcessor {
  private readonly logger = new Logger(ScrapeProcessor.name)

  constructor(
    private readonly storage: StorageService,
    private readonly ingest: IngestService,
    private readonly config: ConfigService,
  ) {}

  @Process()
  async handleScrape(job: Job<ScrapeJob>): Promise<void> {
    const { runId, workspaceId, knowledgeBaseId, url, maxDepth, maxPages, includePrefixes } = job.data

    await db
      .update(scrapeRuns)
      .set({ status: 'running', startedAt: new Date(), error: null })
      .where(eq(scrapeRuns.id, runId))

    try {
      const { crawlSite } = await import('@repo/ai/dist/web/crawl')
      const pages = await crawlSite(url, {
        maxDepth,
        maxPages,
        includePrefixes,
        concurrency: 3,
        requestDelayMs: 500,
        timeoutMs: 20_000,
        userAgent: this.config.get<string>('CRAWLER_USER_AGENT') ?? 'MnemraBot/1.0 (+https://mnemra.com/bot)',
        respectRobots: true,
      })

      let pagesSucceeded = 0
      let pagesFailed = 0

      await db.update(scrapeRuns).set({ pagesFound: pages.length }).where(eq(scrapeRuns.id, runId))

      for (const page of pages) {
        try {
          const storageKey = `${workspaceId}/${knowledgeBaseId}/scrape/${randomUUID()}.txt`
          await this.storage.save(storageKey, Buffer.from(page.content, 'utf-8'), 'text/plain')

          const [document] = await db
            .insert(documents)
            .values({
              workspaceId,
              knowledgeBaseId,
              title: page.title || page.url,
              sourceUrl: page.url,
              storageKey,
              status: 'pending',
            })
            .onConflictDoUpdate({
              target: [documents.knowledgeBaseId, documents.sourceUrl],
              targetWhere: sql`source_url is not null`,
              set: {
                title: page.title || page.url,
                storageKey,
                status: 'pending',
                updatedAt: new Date(),
              },
            })
            .returning()

          await this.ingest.queueDocument(document.id)
          pagesSucceeded += 1
        } catch (error) {
          pagesFailed += 1
          this.logger.warn(
            `Failed to persist scraped page ${page.url}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }

      await db
        .update(scrapeRuns)
        .set({
          status: 'completed',
          pagesSucceeded,
          pagesFailed,
          finishedAt: new Date(),
        })
        .where(eq(scrapeRuns.id, runId))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Scrape failed for run ${runId}`, error instanceof Error ? error.stack : message)

      await db
        .update(scrapeRuns)
        .set({
          status: 'failed',
          error: message,
          finishedAt: new Date(),
        })
        .where(and(eq(scrapeRuns.id, runId), eq(scrapeRuns.workspaceId, workspaceId)))
    }
  }
}
