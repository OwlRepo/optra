import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { StorageModule } from '../storage/storage.module'
import { IngestModule } from '../ingest/ingest.module'
import { CacheModule } from '../cache/cache.module'
import { NotificationsModule } from '../notifications/notifications.module'
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
import { CoverageDashboardService } from './coverage-dashboard.service'
import { TopicGapTickProcessor } from './topic-gap-tick.processor'
import { TopicGapProcessor } from './topic-gap.processor'
import { DigestContentService } from './digest-content.service'
import { DigestSettingsService } from './digest-settings.service'
import { DigestSettingsController } from './digest-settings.controller'
import { DigestTickProcessor } from './digest-tick.processor'
import { DigestProcessor } from './digest.processor'

@Module({
  imports: [
    StorageModule,
    IngestModule,
    CacheModule,
    NotificationsModule,
    BullModule.registerQueue({ name: 'freshness-tick-queue' }),
    BullModule.registerQueue({ name: 'freshness-check-queue' }),
    BullModule.registerQueue({ name: 'faq-cluster-tick-queue' }),
    BullModule.registerQueue({ name: 'faq-cluster-queue' }),
    BullModule.registerQueue({ name: 'topic-gap-tick-queue' }),
    BullModule.registerQueue({ name: 'topic-gap-queue' }),
    BullModule.registerQueue({ name: 'digest-tick-queue' }),
    BullModule.registerQueue({ name: 'digest-queue' }),
  ],
  controllers: [InsightsController, FaqDraftsController, DigestSettingsController],
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
    CoverageDashboardService,
    TopicGapTickProcessor,
    TopicGapProcessor,
    DigestContentService,
    DigestSettingsService,
    DigestTickProcessor,
    DigestProcessor,
  ],
})
export class InsightsModule {}
