import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { RolesGuard } from '../auth/guards/roles.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { DigestSettingsService } from './digest-settings.service'
import { DigestContentService } from './digest-content.service'
import { renderDigestEmailHtml, renderDigestSlackPayload } from './digest-renderers'
import { UpdateDigestSettingsDto } from './dto/update-digest-settings.dto'

// Owner/admin only, both read and write — the Slack webhook URL is
// workspace-sensitive configuration (an external destination for internal
// data), not member-readable like the freshness/FAQ tabs.
@Controller('workspaces/:workspaceId/digest-settings')
@UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
@Roles('owner', 'admin')
export class DigestSettingsController {
  constructor(
    private readonly digestSettings: DigestSettingsService,
    private readonly digestContent: DigestContentService,
  ) {}

  @Get()
  get(@Param('workspaceId') workspaceId: string) {
    return this.digestSettings.get(workspaceId)
  }

  @Patch()
  update(@Param('workspaceId') workspaceId: string, @Body() body: UpdateDigestSettingsDto) {
    return this.digestSettings.update(workspaceId, body)
  }

  // Renders what the next digest would contain, without sending anything —
  // lets a workspace admin see the content before enabling Slack/email.
  @Get('preview')
  async preview(@Param('workspaceId') workspaceId: string) {
    const content = await this.digestContent.build(workspaceId)
    return {
      emailHtml: renderDigestEmailHtml(content),
      slackPayload: renderDigestSlackPayload(content),
    }
  }
}
