import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { BullModule } from '@nestjs/bull'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { DocumentsModule } from './documents/documents.module'
import { IngestModule } from './ingest/ingest.module'
import { ChatModule } from './chat/chat.module'
import { AuthModule } from './auth/auth.module'
import { WorkspacesModule } from './workspaces/workspaces.module'
import { KnowledgeBasesModule } from './knowledge-bases/knowledge-bases.module'
import { StorageModule } from './storage/storage.module'
import { ScrapeModule } from './scrape/scrape.module'
import { TicketsModule } from './tickets/tickets.module'
import { EventsModule } from './events/events.module'
import { SearchModule } from './search/search.module'
import { RefineModule } from './refine/refine.module'
import { DatasetsModule } from './datasets/datasets.module'
import { InsightsModule } from './insights/insights.module'
import { ProcurementModule } from './procurement/procurement.module'
import { CatalogModule } from './catalog/catalog.module'
import { HealthController } from './health/health.controller'

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      // 'bull' is Bull's own default, so leaving BULL_PREFIX unset produces
      // byte-identical Redis keys to before this option existed - production
      // behaviour is unchanged. It exists so e2e runs can namespace their
      // queues: every spec boots the full AppModule, so each parallel jest
      // worker AND the dev `optra-api` container are all consumers of the same
      // queue, and any of them can steal a job whose uploaded file only exists
      // in the enqueueing worker's in-memory StorageService stub. The victim
      // then fails with a real S3 "The specified key does not exist".
      // See apps/api/test/jest-e2e.setup.ts.
      prefix: process.env.BULL_PREFIX || 'bull',
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
    DocumentsModule,
    IngestModule,
    ChatModule,
    AuthModule,
    WorkspacesModule,
    KnowledgeBasesModule,
    StorageModule,
    ScrapeModule,
    TicketsModule,
    EventsModule,
    SearchModule,
    RefineModule,
    DatasetsModule,
    InsightsModule,
    ProcurementModule,
    CatalogModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
