import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Roles } from '../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { DocumentsService } from './documents.service'

@Controller('workspaces/:workspaceId/knowledge-bases/:kbId/documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Param('workspaceId') workspaceId: string,
    @Param('kbId') kbId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('file is required')
    }

    return this.documentsService.upload(workspaceId, kbId, file)
  }

  @Get()
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  list(@Param('workspaceId') workspaceId: string, @Param('kbId') kbId: string) {
    return this.documentsService.listForKnowledgeBase(workspaceId, kbId)
  }

  @Delete(':documentId')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  remove(
    @Param('workspaceId') workspaceId: string,
    @Param('kbId') kbId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documentsService.remove(workspaceId, kbId, documentId)
  }
}
