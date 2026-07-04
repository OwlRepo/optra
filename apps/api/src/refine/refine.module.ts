import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { LimitsModule } from '../limits/limits.module'
import { RefineController } from './refine.controller'
import { RefineService } from './refine.service'
import { RefineRateLimitGuard } from './refine.rate-limit.guard'

@Module({
  imports: [AuthModule, LimitsModule],
  controllers: [RefineController],
  providers: [RefineService, RefineRateLimitGuard],
})
export class RefineModule {}
