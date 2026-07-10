import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Job } from 'bull'
import { eq } from 'drizzle-orm'
import { catalogItems, catalogs, db } from '@repo/db'
import { CatalogImageService } from './catalog-image.service'

type CatalogScrapeJob = {
  id: string
  workspaceId: string
  vendorId: string
  seedUrl: string
  maxDepth: number
  maxPages: number
}

// Mirrors ScrapeProcessor's crawlSite invocation + onPage heartbeat + per-
// page persist + status lifecycle. Unlike ScrapeProcessor, this never
// creates `documents` or calls IngestService (no chunk/embed) — it writes
// catalog_items directly from images found on each crawled page.
@Processor('catalog-scrape-queue')
export class CatalogScrapeProcessor {
  private readonly logger = new Logger(CatalogScrapeProcessor.name)

  constructor(
    private readonly images: CatalogImageService,
    private readonly config: ConfigService,
  ) {}

  @Process()
  async handleScrape(job: Job<CatalogScrapeJob>): Promise<void> {
    const { id, workspaceId, seedUrl, maxDepth, maxPages } = job.data
    const processingStartedAt = new Date()
    let pagesFound = 0
    let pagesSucceeded = 0
    let pagesFailed = 0
    let itemCount = 0

    this.logger.log(`Catalog scrape processor start id=${id} jobId=${String(job.id)}`)

    await db
      .update(catalogs)
      .set({ status: 'processing', processingStartedAt, lastProgressAt: processingStartedAt, lastError: null })
      .where(eq(catalogs.id, id))

    try {
      const { crawlSite, extractProductImages } = await import('@repo/ai')

      await crawlSite(seedUrl, {
        maxDepth,
        maxPages,
        concurrency: 3,
        requestDelayMs: 500,
        timeoutMs: 20_000,
        userAgent: this.config.get<string>('CRAWLER_USER_AGENT') ?? 'MnemraBot/1.0 (+https://mnemra.com/bot)',
        respectRobots: true,
        onPage: async (page, progress) => {
          const lastProgressAt = new Date()
          pagesFound = progress.pagesFound

          await db.update(catalogs).set({ pagesFound, lastProgressAt }).where(eq(catalogs.id, id))

          this.logger.log(
            `Catalog scrape crawled page ${progress.pagesFound}/${progress.maxPages} id=${id} jobId=${String(job.id)} url=${page.url}`,
          )

          try {
            const productImages = extractProductImages(page.html, page.url)
            let pageItemCount = 0

            for (const image of productImages) {
              const photoStorageKey = await this.images.fetchAndStore(workspaceId, id, image.url)
              if (!photoStorageKey) {
                continue
              }

              await db.insert(catalogItems).values({
                workspaceId,
                catalogId: id,
                sku: null,
                description: image.alt,
                photoStorageKey,
                rawRow: { sourceUrl: page.url, imageUrl: image.url, alt: image.alt },
              })
              pageItemCount += 1
            }

            itemCount += pageItemCount
            pagesSucceeded += 1

            await db
              .update(catalogs)
              .set({ pagesFound, pagesSucceeded, pagesFailed, lastProgressAt, rowCount: itemCount })
              .where(eq(catalogs.id, id))

            this.logger.log(
              `Catalog scrape persist success id=${id} jobId=${String(job.id)} url=${page.url} found=${pagesFound} succeeded=${pagesSucceeded} failed=${pagesFailed} items=${pageItemCount}`,
            )
          } catch (error) {
            pagesFailed += 1

            await db
              .update(catalogs)
              .set({ pagesFound, pagesSucceeded, pagesFailed, lastProgressAt })
              .where(eq(catalogs.id, id))

            this.logger.warn(
              `Catalog scrape persist failed id=${id} jobId=${String(job.id)} url=${page.url} found=${pagesFound} succeeded=${pagesSucceeded} failed=${pagesFailed} error=${error instanceof Error ? error.message : String(error)}`,
            )
          }
        },
      })

      await db
        .update(catalogs)
        .set({
          status: 'done',
          pagesFound,
          pagesSucceeded,
          pagesFailed,
          rowCount: itemCount,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(catalogs.id, id))

      this.logger.log(`Catalog scrape processor completed id=${id} jobId=${String(job.id)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Catalog scrape failed for ${id}`, error instanceof Error ? error.stack : message)

      await db
        .update(catalogs)
        .set({ status: 'failed', lastError: message, updatedAt: new Date() })
        .where(eq(catalogs.id, id))
    }
  }
}
