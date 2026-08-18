// Demo seeder for the local Docker stack.
//
//   bun run db:seed                 # real (cached) embeddings
//   bun run db:seed --no-embeddings # skip OpenAI entirely
//   bun run db:seed --wipe-only     # remove the demo tenant, insert nothing
//
// Idempotent: every run deletes exactly the demo workspace's rows, in reverse
// FK order, then re-inserts them inside one transaction. No TRUNCATE and no
// wildcard deletes, so anything else in the local database is left alone.
import { createHash } from 'crypto'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import * as dotenv from 'dotenv'
import { eq, inArray } from 'drizzle-orm'
import Redis from 'ioredis'

import {
  ALLOWED_DB_HOSTS,
  DEFAULT_DATABASE_URL,
  DEFAULT_REDIS_HOST,
  DEFAULT_REDIS_PORT,
  DEMO_PASSWORD,
  DEMO_TEAMMATE_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_ID,
  DEMO_WORKSPACE_ID,
  KB_HELP_CENTER_ID,
} from './config'

// The container sets DATABASE_URL via compose; for host runs fall back to the
// root .env. dotenv never overrides an already-set variable.
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../.env') })

const args = new Set(process.argv.slice(2))
const noEmbeddings = args.has('--no-embeddings')
const wipeOnly = args.has('--wipe-only')
// --once is the production mode: seed if and only if the demo workspace does
// not already exist. Safe to run on every boot; it will never re-seed, never
// wipe, and never touch a demo tenant someone has since edited.
const onceOnly = args.has('--once')

function log(message: string): void {
  console.log(`[seed] ${message}`)
}

function assertLocalDatabase(url: string): void {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${url}`)
  }
  if (!ALLOWED_DB_HOSTS.includes(host) && process.env.SEED_ALLOW_REMOTE !== 'true') {
    throw new Error(
      `refusing to seed a non-local database (host "${host}"). This script DELETES rows. ` +
        `Set SEED_ALLOW_REMOTE=true only if you genuinely mean to target it.`,
    )
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
  assertLocalDatabase(databaseUrl)
  process.env.DATABASE_URL = databaseUrl
  log(`database: ${databaseUrl.replace(/\/\/[^@]*@/, '//***@')}`)

  // Imported after DATABASE_URL is settled — @repo/db builds its pool on import.
  const schema = await import('@repo/db')
  const { db } = schema

  // --once: bail out before doing any work if the tenant is already there.
  if (onceOnly) {
    const existing = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, DEMO_WORKSPACE_ID))
    if (existing.length > 0) {
      log('--once: demo workspace already exists, nothing to do.')
      await schema.pool.end()
      return
    }
    log('--once: demo workspace not found, seeding it now.')
  }

  const bcrypt = await import('bcrypt')
  const { getEmbeddings } = await import('./embeddings')
  const { fetchImages } = await import('./images')
  const { closeStorage, putObject, storageAvailable } = await import('./storage')

  const { buildKnowledgeBases, buildMembers, buildUsers, buildWorkspace } = await import('./data/company')
  const { buildDocumentRows, seedDocuments } = await import('./data/documents')
  const { buildTicketRows, indexedTickets, ticketChunkContent } = await import('./data/tickets')
  const { buildChatMessageRows, buildChatSessionRows } = await import('./data/chat')
  const { TOPIC_GAPS, buildQueryMetricRows } = await import('./data/metrics')
  const { buildEventRows, buildScrapeRunRows } = await import('./data/events')
  const {
    buildBackgroundRunRows,
    buildDigestSettingsRow,
    buildFaqDraftRows,
    buildReviewFlagRows,
    buildSavedRefinedMessageRows,
  } = await import('./data/insights')
  const {
    buildDiscrepancyFlagRows,
    buildInvoiceLineItemRows,
    buildInvoiceRows,
    buildPoLineItemRows,
    buildPurchaseOrderRows,
  } = await import('./data/procurement')
  const {
    buildCatalogItemRows,
    buildCatalogMatchRows,
    buildCatalogPhotoUploads,
    buildCatalogRows,
    buildVendorRows,
    catalogImageKeys,
  } = await import('./data/catalog')
  const { buildDatasetFiles, buildDatasetRows, seedDatasets } = await import('./data/datasets')

  // ---------------------------------------------------------------- embeddings
  const documentChunkSpecs = seedDocuments
    .filter(doc => doc.status === 'done')
    .flatMap(doc => doc.sections.map(section => ({ doc, section })))
  const ticketChunkSpecs = indexedTickets().map(ticket => ({ ticket, content: ticketChunkContent(ticket) }))

  // Dataset descriptions are embedded too — that is how the chat layer picks
  // which dataset a question is about before running SQL against it.
  const texts = [
    ...documentChunkSpecs.map(s => s.section.content),
    ...ticketChunkSpecs.map(s => s.content),
    ...seedDatasets.map(d => d.description),
  ]

  const vectors = wipeOnly
    ? texts.map(() => null)
    : await getEmbeddings(texts, { disabled: noEmbeddings, onProgress: log })

  const datasetEmbeddings = new Map<string, number[] | null>(
    seedDatasets.map((dataset, i) => [
      dataset.id,
      vectors[documentChunkSpecs.length + ticketChunkSpecs.length + i] ?? null,
    ]),
  )

  if (noEmbeddings && !wipeOnly) {
    log('WARNING: --no-embeddings — chunks will have no vectors, so chat retrieval will not rank them.')
  }

  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

  const chunkRows = [
    ...documentChunkSpecs.map(({ doc, section }, i) => ({
      documentId: doc.id,
      ticketId: null,
      workspaceId: DEMO_WORKSPACE_ID,
      content: section.content,
      contentHash: sha256(section.content),
      embedding: vectors[i] ?? null,
      metadata: { fileType: doc.docType, title: doc.title },
      sectionId: section.sectionId,
      sectionTitle: section.sectionTitle,
      sourceType: doc.sourceType,
      docType: doc.docType,
      productArea: null,
    })),
    ...ticketChunkSpecs.map(({ ticket, content }, i) => ({
      documentId: null,
      ticketId: ticket.id,
      workspaceId: DEMO_WORKSPACE_ID,
      content,
      contentHash: sha256(content),
      embedding: vectors[documentChunkSpecs.length + i] ?? null,
      metadata: { ticketId: ticket.id, severity: ticket.severity },
      sectionId: null,
      sectionTitle: null,
      sourceType: 'ticket' as const,
      docType: null,
      productArea: ticket.productArea,
    })),
  ]

  const chatMessages = buildChatMessageRows()
  const assistantMessages = chatMessages.filter(m => m.role === 'assistant')

  // ------------------------------------------------------- object storage
  // Catalog photos and dataset CSVs. Both are optional: if object storage is
  // unreachable the rows still insert, items just fall back to the placeholder
  // tile and datasets keep a storage key that will 404 when queried — which is
  // why the dataset rows are skipped entirely in that case.
  const uploadedImages = new Set<string>()
  let datasetsUploaded = false

  if (!wipeOnly) {
    if (await storageAvailable()) {
      const images = await fetchImages(catalogImageKeys(), log)
      for (const upload of buildCatalogPhotoUploads(new Set(images.keys()))) {
        await putObject(upload.key, images.get(upload.image)!, 'image/jpeg')
      }
      images.forEach((_, key) => uploadedImages.add(key))
      log(`storage: uploaded photos for ${uploadedImages.size} distinct catalog images`)

      for (const file of buildDatasetFiles()) {
        await putObject(file.key, Buffer.from(file.csv, 'utf8'), 'text/csv')
      }
      datasetsUploaded = true
      log(`storage: uploaded ${seedDatasets.length} dataset CSVs`)
    } else {
      log(
        'WARNING: object storage unreachable — skipping catalog photos and datasets. ' +
          'Check S3_ENDPOINT (host runs need http://localhost:8433) or set SEED_S3_ENDPOINT.',
      )
    }
  }

  // ---------------------------------------------------------------- write
  const counts: Record<string, number> = {}

  await db.transaction(async tx => {
    const insert = async (name: string, table: never, rows: unknown[]): Promise<void> => {
      if (rows.length === 0) return
      await tx.insert(table).values(rows as never)
      counts[name] = rows.length
    }

    log('wiping existing demo rows...')
    // Reverse FK order. Several FKs have no ON DELETE CASCADE, so the ordering
    // is load-bearing rather than defensive.
    await tx.delete(schema.catalogMatches).where(eq(schema.catalogMatches.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.catalogItems).where(eq(schema.catalogItems.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.catalogs).where(eq(schema.catalogs.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.vendors).where(eq(schema.vendors.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.discrepancyFlags).where(eq(schema.discrepancyFlags.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.poLineItems).where(eq(schema.poLineItems.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.invoices).where(eq(schema.invoices.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.faqDrafts).where(eq(schema.faqDrafts.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.documentReviewFlags).where(eq(schema.documentReviewFlags.workspaceId, DEMO_WORKSPACE_ID))
    await tx
      .delete(schema.workspaceDigestSettings)
      .where(eq(schema.workspaceDigestSettings.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.backgroundRuns).where(eq(schema.backgroundRuns.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.savedRefinedMessages).where(eq(schema.savedRefinedMessages.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.chatQueryMetrics).where(eq(schema.chatQueryMetrics.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.chatCache).where(eq(schema.chatCache.workspaceId, DEMO_WORKSPACE_ID))
    // chat_messages cascade from chat_sessions.
    await tx.delete(schema.chatSessions).where(eq(schema.chatSessions.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.chunks).where(eq(schema.chunks.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.tickets).where(eq(schema.tickets.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.documents).where(eq(schema.documents.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.datasets).where(eq(schema.datasets.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.scrapeRuns).where(eq(schema.scrapeRuns.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.knowledgeBases).where(eq(schema.knowledgeBases.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.workspaceEvents).where(eq(schema.workspaceEvents.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.invitations).where(eq(schema.invitations.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.workspaceMembers).where(eq(schema.workspaceMembers.workspaceId, DEMO_WORKSPACE_ID))
    await tx.delete(schema.workspaces).where(eq(schema.workspaces.id, DEMO_WORKSPACE_ID))
    const demoUserIds = [DEMO_USER_ID, DEMO_TEAMMATE_ID]
    await tx.delete(schema.refreshTokens).where(inArray(schema.refreshTokens.userId, demoUserIds))
    await tx.delete(schema.otps).where(inArray(schema.otps.userId, demoUserIds))
    await tx.delete(schema.users).where(inArray(schema.users.id, demoUserIds))

    if (wipeOnly) {
      log('--wipe-only: demo tenant removed, nothing inserted.')
      return
    }

    log('inserting demo tenant...')
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12)

    await insert('users', schema.users as never, buildUsers(passwordHash))
    await insert('workspaces', schema.workspaces as never, [buildWorkspace()])
    await insert('workspace_members', schema.workspaceMembers as never, buildMembers())
    await insert('knowledge_bases', schema.knowledgeBases as never, buildKnowledgeBases())
    await insert('documents', schema.documents as never, buildDocumentRows())
    await insert('tickets', schema.tickets as never, buildTicketRows())
    await insert('chunks', schema.chunks as never, chunkRows)
    await insert('scrape_runs', schema.scrapeRuns as never, buildScrapeRunRows(KB_HELP_CENTER_ID))
    // Only insert datasets whose CSV actually made it into object storage —
    // a dataset row pointing at a missing object fails at question time.
    if (datasetsUploaded) {
      await insert('datasets', schema.datasets as never, buildDatasetRows(datasetEmbeddings))
    }
    await insert('chat_sessions', schema.chatSessions as never, buildChatSessionRows())
    await insert(
      'chat_messages',
      schema.chatMessages as never,
      // `question`/`topScore` are seeder-only annotations used to anchor the
      // metrics rows; they are not columns.
      chatMessages.map(({ question, topScore, ...row }) => {
        void question
        void topScore
        return row
      }),
    )
    await insert('chat_query_metrics', schema.chatQueryMetrics as never, buildQueryMetricRows(assistantMessages))
    await insert('workspace_events', schema.workspaceEvents as never, buildEventRows())
    await insert('document_review_flags', schema.documentReviewFlags as never, buildReviewFlagRows())
    await insert('faq_drafts', schema.faqDrafts as never, buildFaqDraftRows())
    await insert('workspace_digest_settings', schema.workspaceDigestSettings as never, [buildDigestSettingsRow()])
    await insert('background_runs', schema.backgroundRuns as never, buildBackgroundRunRows())
    await insert('saved_refined_messages', schema.savedRefinedMessages as never, buildSavedRefinedMessageRows())
    await insert('purchase_orders', schema.purchaseOrders as never, buildPurchaseOrderRows())
    await insert('invoices', schema.invoices as never, buildInvoiceRows())
    await insert('po_line_items', schema.poLineItems as never, buildPoLineItemRows())
    await insert('invoice_line_items', schema.invoiceLineItems as never, buildInvoiceLineItemRows())
    await insert('discrepancy_flags', schema.discrepancyFlags as never, buildDiscrepancyFlagRows())
    await insert('vendors', schema.vendors as never, buildVendorRows())
    await insert('catalogs', schema.catalogs as never, buildCatalogRows())
    await insert('catalog_items', schema.catalogItems as never, buildCatalogItemRows(uploadedImages))
    await insert('catalog_matches', schema.catalogMatches as never, buildCatalogMatchRows())
  })

  await writeRedis(wipeOnly, TOPIC_GAPS)
  closeStorage()
  await schema.pool.end()

  if (wipeOnly) return

  const rows = Object.entries(counts)
    .map(([name, n]) => `  ${name.padEnd(26)} ${n}`)
    .join('\n')
  console.log(`\n${rows}\n`)
  console.log('Demo tenant ready.')
  console.log(`  URL       http://localhost:${process.env.OPTRA_WEB_PORT ?? '3300'}`)
  console.log(`  email     ${DEMO_USER_EMAIL}`)
  console.log(`  password  ${DEMO_PASSWORD}`)
  console.log(`  workspace ${DEMO_WORKSPACE_ID}\n`)
}

/**
 * Two Redis side effects: bump the per-workspace chat cache version so no
 * stale cached answer shadows the freshly seeded chunks (same pattern as
 * scripts/backfill-ticket-embeddings.ts), and write the topic-gap payload the
 * coverage dashboard reads for panel 3.
 */
async function writeRedis(wipe: boolean, topicGaps: unknown): Promise<void> {
  const host = process.env.SEED_REDIS_HOST ?? DEFAULT_REDIS_HOST
  const port = Number.parseInt(process.env.SEED_REDIS_PORT ?? String(DEFAULT_REDIS_PORT), 10)
  const redis = new Redis({
    host,
    port,
    lazyConnect: true,
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
  })
  try {
    await redis.connect()
    await redis.incr(`chat:ver:${DEMO_WORKSPACE_ID}`)
    const key = `insights:topic-gaps:${DEMO_WORKSPACE_ID}`
    if (wipe) {
      await redis.del(key)
    } else {
      await redis.set(key, JSON.stringify(topicGaps))
    }
    log('redis: chat cache version bumped, topic gaps written')
  } catch (error) {
    // Non-fatal: everything except the Insights topic-gap panel works without it.
    log(
      `WARNING: redis step skipped (${(error as Error).message}). Expected redis on ${host}:${port} — ` +
        `override with SEED_REDIS_HOST / SEED_REDIS_PORT.`,
    )
  } finally {
    redis.disconnect()
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('[seed] failed:', error)
    process.exit(1)
  })
