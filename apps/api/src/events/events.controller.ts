import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common'
import { CurrentUser, type CurrentUserContext } from '../auth/decorators/current-user.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { EventsService } from './events.service'
import { ListEventsQueryDto } from './dto/list-events-query.dto'

@Controller('workspaces/:workspaceId/events')
@UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(@Param('workspaceId') workspaceId: string, @Query() query: ListEventsQueryDto) {
    return this.events.list(workspaceId, query)
  }

  @Get('unread-count')
  unreadCount(@Param('workspaceId') workspaceId: string, @CurrentUser() user: CurrentUserContext) {
    return this.events.unreadCount(workspaceId, user.userId).then((count) => ({ count }))
  }

  @Post('mark-seen')
  @HttpCode(204)
  async markSeen(@Param('workspaceId') workspaceId: string, @CurrentUser() user: CurrentUserContext) {
    await this.events.markSeen(workspaceId, user.userId)
  }
}
