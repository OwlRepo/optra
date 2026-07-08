import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { InsightsController } from './insights.controller'
import { InsightsService } from './insights.service'
import { BackgroundRunsService } from './background-runs.service'
import { TicketDocCoverageService } from './ticket-doc-coverage.service'
import { FreshnessTickProcessor } from './freshness-tick.processor'
import { FreshnessCheckProcessor } from './freshness-check.processor'

@Module({
  imports: [
    BullModule.registerQueue({ name: 'freshness-tick-queue' }),
    BullModule.registerQueue({ name: 'freshness-check-queue' }),
  ],
  controllers: [InsightsController],
  providers: [
    InsightsService,
    BackgroundRunsService,
    TicketDocCoverageService,
    FreshnessTickProcessor,
    FreshnessCheckProcessor,
  ],
})
export class InsightsModule {}
