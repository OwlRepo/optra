import { Module } from '@nestjs/common'
import { BillingModule } from '../billing/billing.module'
import { CacheModule } from '../cache/cache.module'
import { RateLimitService } from './rate-limit.service'
import { UsageService } from './usage.service'
import { ChatRateLimitGuard } from './chat-rate-limit.guard'

@Module({
  imports: [CacheModule, BillingModule],
  providers: [RateLimitService, UsageService, ChatRateLimitGuard],
  exports: [RateLimitService, UsageService, ChatRateLimitGuard],
})
export class LimitsModule {}
