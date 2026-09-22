import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
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
import { attachmentDisposition } from '../common/http/content-disposition'
import { ListComparisonRunsQueryDto } from './dto/list-comparison-runs-query.dto'
import { ListDiscrepanciesQueryDto } from './dto/list-discrepancies-query.dto'
import { UploadGoodsReceiptDto } from './dto/upload-goods-receipt.dto'
import { UploadInvoiceDto } from './dto/upload-invoice.dto'
import { UploadPurchaseOrderDto } from './dto/upload-purchase-order.dto'
import { RecordDecisionDto } from './dto/record-decision.dto'
import type { ProcurementDocKind } from './procurement-parse.service'
import { ProcurementDocumentsService } from './procurement-documents.service'
import { pdfExtractionEnabled } from './procurement-feature-flags'

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 25)
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

// Mirrors DatasetsController exactly (datasets.controller.ts): same
// extension/mime allow-list, same size limit, same 413/400 exception
// filter. XLSX is converted to CSV in memory during parsing
// (ProcurementParseProcessor); the stored original is never overwritten. PDFs
// use the text layer when there is one and fall back to page-image extraction
// for scanned PDFs (procurement-extraction.ts).
const SUPPORTED_EXTENSIONS = new Set(['.csv', '.xlsx', '.pdf'])
const SUPPORTED_MIME_TYPES = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'application/pdf',
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
    callback(new BadRequestException('Only CSV, XLSX, or PDF files are supported'), false)
    return
  }

  if (extension === '.pdf' && !pdfExtractionEnabled()) {
    callback(new BadRequestException('PDF uploads are not enabled for this workspace'), false)
    return
  }

  callback(null, true)
}

// Goods receipts are CSV/XLSX only (S5). The PDF extraction chain prompts for
// "purchase order or invoice" and its result shape has no received/accepted/
// rejected fields, so a PDF receipt would land one quantity and silently lose
// the acceptance data — worse than refusing it. Reuses the shared allow-list
// minus '.pdf' rather than a second copy of the extension logic.
function spreadsheetOnlyFileFilter(
  req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) {
  if (extname(file.originalname).toLowerCase() === '.pdf') {
    callback(new BadRequestException('Goods receipts must be CSV or XLSX; PDF is not supported yet'), false)
    return
  }
  fileFilter(req, file, callback)
}

@Catch(MulterError, BadRequestException)
export class UploadExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError | BadRequestException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>()

    if (exception instanceof MulterError && exception.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({ statusCode: 413, message: `File exceeds ${MAX_UPLOAD_MB}MB upload limit` })
      return
    }

    if (exception instanceof BadRequestException) {
      // ValidationPipe throws a body whose `message` is an ARRAY of per-field
      // errors; flattening that loses every field-level message the upload form
      // needs. Testing for an array specifically, not just for an object: Nest
      // also wraps a plain-string BadRequestException (what fileFilter raises)
      // into an object, and passing that through would silently add an `error`
      // key to a response shape clients already depend on.
      const body = exception.getResponse()
      if (typeof body === 'object' && body !== null && Array.isArray((body as { message?: unknown }).message)) {
        response.status(400).json(body)
        return
      }

      response.status(400).json({ statusCode: 400, message: exception.message })
      return
    }

    throw exception
  }
}

// UploadExceptionFilter is scoped to the two upload handlers only. At class
// level it also caught every ValidationPipe/ParseUUIDPipe BadRequestException
// on compare/list/dismiss and flattened the validation detail away.
@Controller('workspaces/:workspaceId/procurement')
export class ProcurementController {
  constructor(
    private readonly documents: ProcurementDocumentsService,
    private readonly comparison: ComparisonService,
  ) {}

  @Post('purchase-orders')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  @UseFilters(UploadExceptionFilter)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES }, fileFilter }))
  uploadPurchaseOrder(
    @Param('workspaceId') workspaceId: string,
    @Body() header: UploadPurchaseOrderDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('file is required')
    }
    return this.documents.upload(workspaceId, 'purchase_order', file, header)
  }

  @Get('purchase-orders')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listPurchaseOrders(@Param('workspaceId') workspaceId: string) {
    return this.documents.listPurchaseOrders(workspaceId)
  }

  @Post('invoices')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  @UseFilters(UploadExceptionFilter)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES }, fileFilter }))
  uploadInvoice(
    @Param('workspaceId') workspaceId: string,
    @Body() header: UploadInvoiceDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('file is required')
    }
    return this.documents.upload(workspaceId, 'invoice', file, header)
  }

  @Get('invoices')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listInvoices(@Param('workspaceId') workspaceId: string) {
    return this.documents.listInvoices(workspaceId)
  }

  @Post('goods-receipts')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  @UseFilters(UploadExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES }, fileFilter: spreadsheetOnlyFileFilter }),
  )
  uploadGoodsReceipt(
    @Param('workspaceId') workspaceId: string,
    @Body() header: UploadGoodsReceiptDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('file is required')
    }
    return this.documents.upload(workspaceId, 'goods_receipt', file, header)
  }

  @Get('goods-receipts')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listGoodsReceipts(@Param('workspaceId') workspaceId: string) {
    return this.documents.listGoodsReceipts(workspaceId)
  }

  // The original uploaded file, so a reviewer can check a discrepancy against
  // its source (D4). Member-readable, matching the document download in the
  // knowledge-base domain and the list routes above.
  //
  // Always an attachment, and always octet-stream: the stored content type is
  // deliberately not echoed. These bytes are user-uploaded and are served from
  // the web app's own origin through the BFF proxy, so anything the browser
  // would render inline could execute there. `nosniff` is belt-and-braces —
  // the only other place it is set is docker/Caddyfile, which is absent in
  // local dev and in any non-Caddy topology.
  @Get('purchase-orders/:docId/download')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  async downloadPurchaseOrder(
    @Param('workspaceId') workspaceId: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Res() res: Response,
  ) {
    await this.sendSourceDocument(res, workspaceId, 'purchase_order', docId)
  }

  @Get('invoices/:docId/download')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  async downloadInvoice(
    @Param('workspaceId') workspaceId: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Res() res: Response,
  ) {
    await this.sendSourceDocument(res, workspaceId, 'invoice', docId)
  }

  @Get('goods-receipts/:docId/download')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  async downloadGoodsReceipt(
    @Param('workspaceId') workspaceId: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Res() res: Response,
  ) {
    await this.sendSourceDocument(res, workspaceId, 'goods_receipt', docId)
  }

  private async sendSourceDocument(
    res: Response,
    workspaceId: string,
    kind: ProcurementDocKind,
    docId: string,
  ): Promise<void> {
    const { name, buffer } = await this.documents.getDownloadable(workspaceId, kind, docId)

    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': attachmentDisposition(name),
      'Content-Length': String(buffer.length),
      'X-Content-Type-Options': 'nosniff',
    })
    res.send(buffer)
  }

  @Post('discrepancies/compare')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  compare(
    @Param('workspaceId') workspaceId: string,
    @Body() body: CompareDocumentsDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.comparison.compare(workspaceId, body.purchaseOrderId, body.invoiceId, user.userId)
  }

  @Get('discrepancies')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listDiscrepancies(@Param('workspaceId') workspaceId: string, @Query() query: ListDiscrepanciesQueryDto) {
    return this.comparison.listFlags(workspaceId, query)
  }

  /**
   * Run history (S7). Member-readable like every other procurement read —
   * seeing what a comparison concluded is not deciding anything.
   */
  @Get('comparison-runs')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listComparisonRuns(@Param('workspaceId') workspaceId: string, @Query() query: ListComparisonRunsQueryDto) {
    return this.comparison.listRuns(workspaceId, query)
  }

  @Patch('discrepancies/:flagId/dismiss')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  dismiss(
    @Param('workspaceId') workspaceId: string,
    @Param('flagId', new ParseUUIDPipe()) flagId: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.comparison.dismissFlag(workspaceId, flagId, user.userId)
  }

  // Append-only audit trail (POLICY v1 #7). Writing requires a real note and
  // the same owner/admin role as dismiss; reading is open to members, so a
  // reviewer can see why a flag was closed without being able to close one.
  @Post('discrepancies/:flagId/decisions')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  recordDecision(
    @Param('workspaceId') workspaceId: string,
    @Param('flagId', new ParseUUIDPipe()) flagId: string,
    @Body() body: RecordDecisionDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.comparison.recordDecision(workspaceId, flagId, user.userId, body)
  }

  @Get('discrepancies/:flagId/decisions')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listDecisions(
    @Param('workspaceId') workspaceId: string,
    @Param('flagId', new ParseUUIDPipe()) flagId: string,
  ) {
    return this.comparison.listDecisions(workspaceId, flagId)
  }
}
