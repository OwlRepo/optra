import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { CurrentUser, type CurrentUserContext } from '../auth/decorators/current-user.decorator'
import { CurrentWorkspaceMember } from '../auth/decorators/current-workspace-member.decorator'
import { Roles } from '../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { WorkspaceMemberGuard, type WorkspaceMemberContext } from '../auth/guards/workspace-member.guard'
import { ListQueryDto } from '../common/dto/list-query.dto'
import { CreateWorkspaceDto } from './dto/create-workspace.dto'
import { InviteMemberDto } from './dto/invite-member.dto'
import { ListMembersQueryDto } from './dto/list-members-query.dto'
import { UpdateWorkspaceDto } from './dto/update-workspace.dto'
import { WorkspacesService } from './workspaces.service'

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: CurrentUserContext,
    @Body() dto: CreateWorkspaceDto,
  ) {
    return this.workspacesService.create(user.userId, dto.name)
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  listMine(@CurrentUser() user: CurrentUserContext, @Query() query: ListQueryDto) {
    return this.workspacesService.listForUser(user.userId, query)
  }

  @Post('accept-invite/:token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  accept(
    @CurrentUser() user: CurrentUserContext,
    @Param('token') token: string,
  ) {
    return this.workspacesService.acceptInvite(user.userId, user.email, token)
  }

  @Get(':workspaceId')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  async getOne(
    @Param('workspaceId') workspaceId: string,
    @CurrentWorkspaceMember() member: WorkspaceMemberContext,
  ) {
    // The caller's role travels with the workspace (already loaded by the
    // guard), so pages never derive it from page 1 of /workspaces/me.
    return { ...(await this.workspacesService.getOne(workspaceId)), role: member.role }
  }

  @Post(':workspaceId/invite')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  invite(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: InviteMemberDto,
  ) {
    return this.workspacesService.invite(workspaceId, dto.email)
  }

  @Patch(':workspaceId')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  update(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspacesService.update(workspaceId, dto.name)
  }

  @Get(':workspaceId/members')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listMembers(
    @Param('workspaceId') workspaceId: string,
    @Query() query: ListMembersQueryDto,
  ) {
    return this.workspacesService.listMembers(workspaceId, query)
  }

  @Delete(':workspaceId/members/:userId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner')
  remove(
    @Param('workspaceId') workspaceId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.workspacesService.removeMember(workspaceId, userId)
  }
}
