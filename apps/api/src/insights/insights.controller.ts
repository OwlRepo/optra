import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common'
import { CurrentUser, type CurrentUserContext } from '../auth/decorators/current-user.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { InsightsService } from './insights.service'

@Controller('workspaces/:workspaceId/insights')
@UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
export class InsightsController {
  constructor(private readonly insightsService: InsightsService) {}

  @Get('freshness-flags')
  listFreshnessFlags(@Param('workspaceId') workspaceId: string) {
    return this.insightsService.listFreshnessFlags(workspaceId)
  }

  @Patch('freshness-flags/:flagId/dismiss')
  dismissFlag(
    @Param('workspaceId') workspaceId: string,
    @Param('flagId') flagId: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.insightsService.dismissFlag(workspaceId, flagId, user.userId)
  }
}
