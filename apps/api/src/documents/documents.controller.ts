import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  HttpCode,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import archiver from 'archiver'
import { extname } from 'path'
import { MulterError } from 'multer'
import { Roles } from '../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { DownloadManyDto } from './dto/download-many.dto'
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto'
import { DocumentsService } from './documents.service'

function safeFilename(name: string): string {
  return name.replace(/["\r\n]/g, '_')
}

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 25)
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
const SUPPORTED_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.mdx',
  '.rst',
  '.pdf',
  '.docx',
  '.csv',
  '.json',
  '.html',
  '.htm',
  '.xlsx',
  '.pptx',
  '.eml',
  '.msg',
  '.yaml',
  '.yml',
])
const SUPPORTED_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'application/json',
  'text/html',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'message/rfc822',
  'application/vnd.ms-outlook',
  'application/x-yaml',
  'text/yaml',
  'text/x-yaml',
  'application/octet-stream',
])

function fileFilter(
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) {
  const extension = extname(file.originalname).toLowerCase()
  const isAllowedExtension = SUPPORTED_EXTENSIONS.has(extension)
  const isAllowedMime = SUPPORTED_MIME_TYPES.has(file.mimetype)

  if (!isAllowedExtension || !isAllowedMime) {
    callback(new BadRequestException('Unsupported file type'), false)
    return
  }

  callback(null, true)
}

@Catch(MulterError, BadRequestException)
class UploadExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError | BadRequestException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>()

    if (exception instanceof MulterError && exception.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({
        statusCode: 413,
        message: `File exceeds ${MAX_UPLOAD_MB}MB upload limit`,
      })
      return
    }

    if (exception instanceof BadRequestException) {
      response.status(400).json({
        statusCode: 400,
        message: exception.message,
      })
      return
    }

    throw exception
  }
}

@Controller('workspaces/:workspaceId/knowledge-bases/:kbId/documents')
@UseFilters(UploadExceptionFilter)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter,
    }),
  )
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
  list(
    @Param('workspaceId') workspaceId: string,
    @Param('kbId') kbId: string,
    @Query() query: ListDocumentsQueryDto,
  ) {
    return this.documentsService.listForKnowledgeBase(workspaceId, kbId, query)
  }

  @Post('download')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  async downloadMany(
    @Param('workspaceId') workspaceId: string,
    @Param('kbId') kbId: string,
    @Body() body: DownloadManyDto,
    @Res() res: Response,
  ) {
    const files = await this.documentsService.getManyDownloadable(workspaceId, kbId, body.documentIds)

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="documents.zip"',
    })

    const archive = archiver('zip', { zlib: { level: 9 } })
    archive.on('error', (error) => res.destroy(error))
    archive.pipe(res)

    const usedNames = new Set<string>()
    for (const file of files) {
      let name = file.title
      let suffix = 1
      while (usedNames.has(name)) {
        name = `${suffix}-${file.title}`
        suffix += 1
      }
      usedNames.add(name)
      archive.append(file.buffer, { name })
    }

    await archive.finalize()
  }

  @Get(':documentId/download')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  async download(
    @Param('workspaceId') workspaceId: string,
    @Param('kbId') kbId: string,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ) {
    const { title, buffer } = await this.documentsService.getDownloadable(workspaceId, kbId, documentId)

    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeFilename(title)}"`,
      'Content-Length': String(buffer.length),
    })
    res.send(buffer)
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
