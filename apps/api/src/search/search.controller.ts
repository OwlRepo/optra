import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { SearchService } from './search.service'

@Controller('workspaces/:workspaceId/search')
@UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  searchWorkspace(@Param('workspaceId') workspaceId: string, @Query('q') q: string) {
    return this.search.search(workspaceId, q ?? '')
  }
}
