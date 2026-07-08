import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common'
import { CurrentUser, type CurrentUserContext } from '../auth/decorators/current-user.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { RolesGuard } from '../auth/guards/roles.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { FaqDraftsService } from './faq-drafts.service'

// Approve/reject are owner/admin only — LLM-authored content entering the
// corpus is a hard human-approval-gate invariant per the plan, not a
// member-level action like reading the draft list.
@Controller('workspaces/:workspaceId/insights/faq-drafts')
@UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
export class FaqDraftsController {
  constructor(private readonly faqDraftsService: FaqDraftsService) {}

  @Get()
  list(@Param('workspaceId') workspaceId: string) {
    return this.faqDraftsService.list(workspaceId)
  }

  @Patch(':draftId/approve')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  approve(
    @Param('workspaceId') workspaceId: string,
    @Param('draftId') draftId: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.faqDraftsService.approve(workspaceId, draftId, user.userId)
  }

  @Patch(':draftId/reject')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  reject(
    @Param('workspaceId') workspaceId: string,
    @Param('draftId') draftId: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.faqDraftsService.reject(workspaceId, draftId, user.userId)
  }
}
