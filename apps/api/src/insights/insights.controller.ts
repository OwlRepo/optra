import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common'
import { CurrentUser, type CurrentUserContext } from '../auth/decorators/current-user.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { InsightsService } from './insights.service'
import { CoverageDashboardService } from './coverage-dashboard.service'

@Controller('workspaces/:workspaceId/insights')
@UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
export class InsightsController {
  constructor(
    private readonly insightsService: InsightsService,
    private readonly coverageDashboard: CoverageDashboardService,
  ) {}

  @Get('freshness-flags')
  listFreshnessFlags(@Param('workspaceId') workspaceId: string) {
    return this.insightsService.listFreshnessFlags(workspaceId)
  }

  // V2 F7a: tab 3, read-only. summary/lowScoreQueries are computed live;
  // topicGaps is whatever the last weekly job cached (empty until it runs).
  @Get('coverage')
  async getCoverage(@Param('workspaceId') workspaceId: string) {
    const [summary, lowScoreQueries, topicGaps] = await Promise.all([
      this.coverageDashboard.getSummary(workspaceId),
      this.coverageDashboard.getLowScoreQueries(workspaceId),
      this.coverageDashboard.getTopicGaps(workspaceId),
    ])
    return { summary, lowScoreQueries, topicGaps }
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
