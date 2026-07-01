import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { Roles } from '../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { ListQueryDto } from '../common/dto/list-query.dto'
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto'
import { KnowledgeBasesService } from './knowledge-bases.service'

@Controller('workspaces/:workspaceId/knowledge-bases')
export class KnowledgeBasesController {
  constructor(private readonly knowledgeBasesService: KnowledgeBasesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  create(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateKnowledgeBaseDto,
  ) {
    return this.knowledgeBasesService.create(workspaceId, dto.name)
  }

  @Get()
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  list(@Param('workspaceId') workspaceId: string, @Query() query: ListQueryDto) {
    return this.knowledgeBasesService.listForWorkspace(workspaceId, query)
  }

  @Delete(':kbId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  remove(
    @Param('workspaceId') workspaceId: string,
    @Param('kbId') kbId: string,
  ) {
    return this.knowledgeBasesService.remove(workspaceId, kbId)
  }
}
