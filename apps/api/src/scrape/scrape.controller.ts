import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { Roles } from '../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { ScrapeDto } from './dto/scrape.dto'
import { ScrapeService } from './scrape.service'

@Controller('workspaces/:workspaceId/knowledge-bases/:kbId')
export class ScrapeController {
  constructor(private readonly scrapeService: ScrapeService) {}

  @Post('scrape')
  @HttpCode(202)
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  start(
    @Param('workspaceId') workspaceId: string,
    @Param('kbId') kbId: string,
    @Body() dto: ScrapeDto,
  ) {
    return this.scrapeService.startScrape(workspaceId, kbId, dto)
  }

  @Get('scrape-runs')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  list(@Param('workspaceId') workspaceId: string, @Param('kbId') kbId: string) {
    return this.scrapeService.listRuns(workspaceId, kbId)
  }
}
