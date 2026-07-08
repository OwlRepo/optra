import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  Param,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { extname } from 'path'
import { MulterError } from 'multer'
import { Roles } from '../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { DatasetsService } from './datasets.service'

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 25)
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

// XLSX uploads are converted to CSV during profiling (see
// DatasetProfilingProcessor) so DuckDbQueryService only ever reads CSV.
const SUPPORTED_EXTENSIONS = new Set(['.csv', '.xlsx'])
const SUPPORTED_MIME_TYPES = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
    callback(new BadRequestException('Only CSV or XLSX files are supported for datasets'), false)
    return
  }

  callback(null, true)
}

@Catch(MulterError, BadRequestException)
class UploadExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError | BadRequestException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>()

    if (exception instanceof MulterError && exception.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({ statusCode: 413, message: `File exceeds ${MAX_UPLOAD_MB}MB upload limit` })
      return
    }

    if (exception instanceof BadRequestException) {
      response.status(400).json({ statusCode: 400, message: exception.message })
      return
    }

    throw exception
  }
}

@Controller('workspaces/:workspaceId/datasets')
@UseFilters(UploadExceptionFilter)
export class DatasetsController {
  constructor(private readonly datasetsService: DatasetsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES }, fileFilter }))
  upload(@Param('workspaceId') workspaceId: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('file is required')
    }

    return this.datasetsService.upload(workspaceId, file)
  }

  @Get()
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  list(@Param('workspaceId') workspaceId: string) {
    return this.datasetsService.list(workspaceId)
  }

  @Delete(':datasetId')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  remove(@Param('workspaceId') workspaceId: string, @Param('datasetId') datasetId: string) {
    return this.datasetsService.remove(workspaceId, datasetId)
  }
}
