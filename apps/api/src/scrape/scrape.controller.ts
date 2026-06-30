import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
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
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  async start(
    @Param('workspaceId') workspaceId: string,
    @Param('kbId') kbId: string,
    @Body() dto: ScrapeDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.scrapeService.startScrape(workspaceId, kbId, dto)
    response.status(result.reusedExisting ? 200 : 202)
    return { runId: result.runId, status: result.status }
  }

  @Get('scrape-runs')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  list(@Param('workspaceId') workspaceId: string, @Param('kbId') kbId: string) {
    return this.scrapeService.listRuns(workspaceId, kbId)
  }
}
