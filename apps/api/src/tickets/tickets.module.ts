import { BullModule } from '@nestjs/bull'
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { CacheModule } from '../cache/cache.module'
import { EventsModule } from '../events/events.module'
import { TicketExtractionProcessor } from './ticket-extraction.processor'
import { TicketsController } from './tickets.controller'
import { TicketsService } from './tickets.service'

@Module({
  imports: [
    AuthModule,
    EventsModule,
    CacheModule,
    BullModule.registerQueue({
      name: 'ticket-extraction-queue',
    }),
  ],
  controllers: [TicketsController],
  providers: [TicketsService, TicketExtractionProcessor, JwtAuthGuard, WorkspaceMemberGuard],
  exports: [TicketsService],
})
export class TicketsModule {}
