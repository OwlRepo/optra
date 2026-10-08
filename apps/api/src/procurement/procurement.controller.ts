import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express'
import { Throttle } from '@nestjs/throttler'
import type { Response } from 'express'
import { extname } from 'path'
import { CurrentUser, CurrentUserContext } from '../auth/decorators/current-user.decorator'
import { Roles } from '../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { ComparisonService } from './comparison.service'
import { buildWorkbook, evidenceFilename } from './evidence-export'
import { CompareDocumentsDto } from './dto/compare-documents.dto'
import { attachmentDisposition } from '../common/http/content-disposition'
import { ListComparisonRunsQueryDto } from './dto/list-comparison-runs-query.dto'
import { ListDiscrepanciesQueryDto } from './dto/list-discrepancies-query.dto'
import { UploadGoodsReceiptDto } from './dto/upload-goods-receipt.dto'
import { UploadInvoiceDto } from './dto/upload-invoice.dto'
import { UploadPurchaseOrderDto } from './dto/upload-purchase-order.dto'
import { RecordDecisionDto } from './dto/record-decision.dto'
import { ReviewDocumentDto } from './dto/review-document.dto'
import { OffsetQueryDto } from '../common/dto/offset-query.dto'
import { MAX_PHOTO_PAGES } from './procurement-photo'
import { ProcurementReviewService } from './procurement-review.service'
import type { ProcurementDocKind } from './procurement-parse.service'
import { ProcurementDocumentsService } from './procurement-documents.service'
import { PHOTO_UPLOADS_DISABLED_MESSAGE, pdfExtractionEnabled } from './procurement-feature-flags'
import { PhotoUploadExceptionFilter, UploadExceptionFilter } from '../common/http/upload-exception.filter'
import { maxUploadBytes } from '../common/http/upload-limit'

const MAX_UPLOAD_BYTES = maxUploadBytes()

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

// Photo intake: up to MAX_PHOTO_PAGES phone photos become ONE document. The
// extension and MIME are a first gate only; normalizePhoto re-checks the real
// magic bytes. HEIC gets its own message because iOS can hand it over.
const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'])
const HEIC_EXTENSIONS = new Set(['.heic', '.heif'])
const HEIC_MIME_TYPES = new Set(['image/heic', 'image/heif'])
const HEIC_MESSAGE = 'HEIC/HEIF photos are not supported — export as JPEG and upload again'

export function photoFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) {
  // Photos spend vision tokens like PDFs do, so the same switch; checked first,
  // before any bytes reach sharp.
  if (!pdfExtractionEnabled()) {
    callback(new BadRequestException(PHOTO_UPLOADS_DISABLED_MESSAGE), false)
    return
  }

  const extension = extname(file.originalname).toLowerCase()

  if (HEIC_EXTENSIONS.has(extension) || HEIC_MIME_TYPES.has(file.mimetype.toLowerCase())) {
    callback(new BadRequestException(HEIC_MESSAGE), false)
    return
  }

  if (!PHOTO_EXTENSIONS.has(extension) || !PHOTO_MIME_TYPES.has(file.mimetype)) {
    callback(new BadRequestException('Photos must be JPEG, PNG or WebP images'), false)
    return
  }

  callback(null, true)
}

const photoUploadInterceptor = () =>
  FilesInterceptor('files', MAX_PHOTO_PAGES, { limits: { fileSize: MAX_UPLOAD_BYTES }, fileFilter: photoFileFilter })

// UploadExceptionFilter is scoped to the two upload handlers only. At class
// level it also caught every ValidationPipe/ParseUUIDPipe BadRequestException
// on compare/list/dismiss and flattened the validation detail away.
@Controller('workspaces/:workspaceId/procurement')
export class ProcurementController {
  constructor(
    private readonly documents: ProcurementDocumentsService,
    private readonly comparison: ComparisonService,
    private readonly review: ProcurementReviewService,
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

  // ---- Photo intake ----------------------------------------------------------

  @Post('purchase-orders/photos')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  @UseFilters(PhotoUploadExceptionFilter)
  @UseInterceptors(photoUploadInterceptor())
  uploadPurchaseOrderPhotos(
    @Param('workspaceId') workspaceId: string,
    @Body() header: UploadPurchaseOrderDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('files are required')
    }
    return this.documents.uploadPhotos(workspaceId, 'purchase_order', files, header)
  }

  @Get('purchase-orders/:docId/lines')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listPurchaseOrderLines(
    @Param('workspaceId') workspaceId: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Query() query: OffsetQueryDto,
  ) {
    return this.review.listLines(workspaceId, 'purchase_order', docId, query)
  }

  @Get('purchase-orders/:docId/pages/:n')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  async getPurchaseOrderPage(
    @Param('workspaceId') workspaceId: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Param('n', ParseIntPipe) n: number,
    @Res() res: Response,
  ) {
    await this.sendPage(res, workspaceId, 'purchase_order', docId, n)
  }

  @Post('purchase-orders/:docId/review')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  reviewPurchaseOrder(
    @Param('workspaceId') workspaceId: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Body() body: ReviewDocumentDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.review.review(workspaceId, 'purchase_order', docId, user.userId, body)
  }

  @Post('invoices/photos')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  @UseFilters(PhotoUploadExceptionFilter)
  @UseInterceptors(photoUploadInterceptor())
  uploadInvoicePhotos(
    @Param('workspaceId') workspaceId: string,
    @Body() header: UploadInvoiceDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('files are required')
    }
    return this.documents.uploadPhotos(workspaceId, 'invoice', files, header)
  }

  @Get('invoices/:docId/lines')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listInvoiceLines(
    @Param('workspaceId') workspaceId: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Query() query: OffsetQueryDto,
  ) {
    return this.review.listLines(workspaceId, 'invoice', docId, query)
  }

  @Get('invoices/:docId/pages/:n')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  async getInvoicePage(
    @Param('workspaceId') workspaceId: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Param('n', ParseIntPipe) n: number,
    @Res() res: Response,
  ) {
    await this.sendPage(res, workspaceId, 'invoice', docId, n)
  }

  @Post('invoices/:docId/review')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  reviewInvoice(
    @Param('workspaceId') workspaceId: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Body() body: ReviewDocumentDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.review.review(workspaceId, 'invoice', docId, user.userId, body)
  }

  @Post('goods-receipts/photos')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  @UseFilters(PhotoUploadExceptionFilter)
  @UseInterceptors(photoUploadInterceptor())
  uploadGoodsReceiptPhotos(
    @Param('workspaceId') workspaceId: string,
    @Body() header: UploadGoodsReceiptDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('files are required')
    }
    return this.documents.uploadPhotos(workspaceId, 'goods_receipt', files, header)
  }

  @Get('goods-receipts/:docId/lines')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listGoodsReceiptLines(
    @Param('workspaceId') workspaceId: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Query() query: OffsetQueryDto,
  ) {
    return this.review.listLines(workspaceId, 'goods_receipt', docId, query)
  }

  @Get('goods-receipts/:docId/pages/:n')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  async getGoodsReceiptPage(
    @Param('workspaceId') workspaceId: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Param('n', ParseIntPipe) n: number,
    @Res() res: Response,
  ) {
    await this.sendPage(res, workspaceId, 'goods_receipt', docId, n)
  }

  @Post('goods-receipts/:docId/review')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  reviewGoodsReceipt(
    @Param('workspaceId') workspaceId: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Body() body: ReviewDocumentDto,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.review.review(workspaceId, 'goods_receipt', docId, user.userId, body)
  }

  // Page images are user-derived bytes served from the web app's own origin, so
  // they are locked down: a fixed image/jpeg type, nosniff and a sandboxing CSP.
  // Headers are set only after the service has answered, so a 404 stays a clean
  // JSON error.
  private async sendPage(
    res: Response,
    workspaceId: string,
    kind: ProcurementDocKind,
    docId: string,
    n: number,
  ): Promise<void> {
    const buffer = await this.review.getPage(workspaceId, kind, docId, n)

    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      // Photos of financial documents, possibly on a shared device: never kept.
      'Cache-Control': 'private, no-store',
      'Content-Length': String(buffer.length),
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
   * Evidence-trail workbook (Flags + Decisions). Same scope and member-readable
   * guards as the list; declared before any `discrepancies/:flagId` route.
   * Pagination fields in the query are ignored.
   */
  @Get('discrepancies/export')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  async exportDiscrepancies(
    @Param('workspaceId') workspaceId: string,
    @Query() query: ListDiscrepanciesQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { purchaseOrderId, invoiceId, status, runId } = query
    const data = await this.comparison.exportFlags(workspaceId, { purchaseOrderId, invoiceId, status, runId })
    const buffer = buildWorkbook(data)

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': attachmentDisposition(evidenceFilename(new Date())),
      'Content-Length': String(buffer.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    })
    res.send(buffer)
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
