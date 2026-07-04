import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { CurrentUser, type CurrentUserContext } from '../auth/decorators/current-user.decorator'
import { Roles } from '../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
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
  getOne(@Param('workspaceId') workspaceId: string) {
    return this.workspacesService.getOne(workspaceId)
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
    @Param('userId') userId: string,
  ) {
    return this.workspacesService.removeMember(workspaceId, userId)
  }
}
