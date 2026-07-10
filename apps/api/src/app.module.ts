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
