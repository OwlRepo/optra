import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { StorageModule } from '../storage/storage.module'
import { IngestModule } from '../ingest/ingest.module'
import { InsightsController } from './insights.controller'
import { InsightsService } from './insights.service'
import { BackgroundRunsService } from './background-runs.service'
import { TicketDocCoverageService } from './ticket-doc-coverage.service'
import { FreshnessTickProcessor } from './freshness-tick.processor'
import { FreshnessCheckProcessor } from './freshness-check.processor'
import { FaqClusterService } from './faq-cluster.service'
import { FaqClusterTickProcessor } from './faq-cluster-tick.processor'
import { FaqClusterProcessor } from './faq-cluster.processor'
import { FaqDraftsService } from './faq-drafts.service'
import { FaqDraftsController } from './faq-drafts.controller'

@Module({
  imports: [
    StorageModule,
    IngestModule,
    BullModule.registerQueue({ name: 'freshness-tick-queue' }),
    BullModule.registerQueue({ name: 'freshness-check-queue' }),
    BullModule.registerQueue({ name: 'faq-cluster-tick-queue' }),
    BullModule.registerQueue({ name: 'faq-cluster-queue' }),
  ],
  controllers: [InsightsController, FaqDraftsController],
  providers: [
    InsightsService,
    BackgroundRunsService,
    TicketDocCoverageService,
    FreshnessTickProcessor,
    FreshnessCheckProcessor,
    FaqClusterService,
    FaqClusterTickProcessor,
    FaqClusterProcessor,
    FaqDraftsService,
  ],
})
export class InsightsModule {}
