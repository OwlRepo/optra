import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { extname } from 'path'
import { MulterError } from 'multer'
import { CurrentUser, CurrentUserContext } from '../auth/decorators/current-user.decorator'
import { Roles } from '../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { ComparisonService } from './comparison.service'
import { CompareDocumentsDto } from './dto/compare-documents.dto'
import { ListDiscrepanciesQueryDto } from './dto/list-discrepancies-query.dto'
import { ProcurementDocumentsService } from './procurement-documents.service'

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 25)
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

// Mirrors DatasetsController exactly (datasets.controller.ts): same
// extension/mime allow-list, same size limit, same 413/400 exception
// filter. XLSX is converted to CSV during parsing (ProcurementParseProcessor)
// so nothing downstream ever reads XLSX directly.
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
    callback(new BadRequestException('Only CSV or XLSX files are supported'), false)
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

@Controller('workspaces/:workspaceId/procurement')
@UseFilters(UploadExceptionFilter)
export class ProcurementController {
  constructor(
    private readonly documents: ProcurementDocumentsService,
    private readonly comparison: ComparisonService,
  ) {}

  @Post('purchase-orders')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES }, fileFilter }))
  uploadPurchaseOrder(@Param('workspaceId') workspaceId: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('file is required')
    }
    return this.documents.upload(workspaceId, 'purchase_order', file)
  }

  @Get('purchase-orders')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listPurchaseOrders(@Param('workspaceId') workspaceId: string) {
    return this.documents.list(workspaceId, 'purchase_order')
  }

  @Post('invoices')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES }, fileFilter }))
  uploadInvoice(@Param('workspaceId') workspaceId: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('file is required')
    }
    return this.documents.upload(workspaceId, 'invoice', file)
  }

  @Get('invoices')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listInvoices(@Param('workspaceId') workspaceId: string) {
    return this.documents.list(workspaceId, 'invoice')
  }

  @Post('discrepancies/compare')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  compare(@Param('workspaceId') workspaceId: string, @Body() body: CompareDocumentsDto) {
    return this.comparison.compare(workspaceId, body.purchaseOrderId, body.invoiceId)
  }

  @Get('discrepancies')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listDiscrepancies(@Param('workspaceId') workspaceId: string, @Query() query: ListDiscrepanciesQueryDto) {
    return this.comparison.listFlags(workspaceId, query)
  }

  @Patch('discrepancies/:flagId/dismiss')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  dismiss(
    @Param('workspaceId') workspaceId: string,
    @Param('flagId') flagId: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.comparison.dismissFlag(workspaceId, flagId, user.userId)
  }
}
