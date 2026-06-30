import { Module } from '@nestjs/common'
import { CacheModule } from '../cache/cache.module'
import { RateLimitService } from './rate-limit.service'
import { UsageService } from './usage.service'
import { ChatRateLimitGuard } from './chat-rate-limit.guard'

@Module({
  imports: [CacheModule],
  providers: [RateLimitService, UsageService, ChatRateLimitGuard],
  exports: [RateLimitService, UsageService, ChatRateLimitGuard],
})
export class LimitsModule {}
