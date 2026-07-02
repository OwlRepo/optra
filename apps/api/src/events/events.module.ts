import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { EventsController } from './events.controller'
import { EventsService } from './events.service'

@Module({
  imports: [AuthModule],
  controllers: [EventsController],
  providers: [EventsService, JwtAuthGuard, WorkspaceMemberGuard],
  exports: [EventsService],
})
export class EventsModule {}
