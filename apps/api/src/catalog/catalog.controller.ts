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
import { CatalogDocumentsService } from './catalog-documents.service'
import { CatalogMatchService } from './catalog-match.service'
import { CatalogScrapeService } from './catalog-scrape.service'
import { CatalogMatchDto } from './dto/catalog-match.dto'
import { CreateVendorDto } from './dto/create-vendor.dto'
import { ListCatalogMatchesQueryDto } from './dto/list-catalog-matches-query.dto'
import { ScrapeCatalogDto } from './dto/scrape-catalog.dto'
import { VendorsService } from './vendors.service'

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 25)
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.csv', '.xlsx'])
const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
])

function catalogEnabled(): boolean {
  return process.env.CATALOG_ENABLED === 'true'
}

// Mirrors ProcurementController's fileFilter/UploadExceptionFilter exactly,
// gated on CATALOG_ENABLED (blanket, not per-extension like PROCUREMENT_PDF_
// EXTRACTION_ENABLED — the whole catalog domain is flag-gated, not just PDF).
function fileFilter(
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) {
  if (!catalogEnabled()) {
    callback(new BadRequestException('Catalog uploads are not enabled for this workspace'), false)
    return
  }

  const extension = extname(file.originalname).toLowerCase()
  const isAllowedExtension = SUPPORTED_EXTENSIONS.has(extension)
  const isAllowedMime = SUPPORTED_MIME_TYPES.has(file.mimetype)

  if (!isAllowedExtension || !isAllowedMime) {
    callback(new BadRequestException('Only PDF, CSV, or XLSX files are supported'), false)
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

@Controller('workspaces/:workspaceId')
@UseFilters(UploadExceptionFilter)
export class CatalogController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly documents: CatalogDocumentsService,
    private readonly scrape: CatalogScrapeService,
    private readonly matches: CatalogMatchService,
  ) {}

  @Post('vendors')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  createVendor(@Param('workspaceId') workspaceId: string, @Body() body: CreateVendorDto) {
    return this.vendors.create(workspaceId, body)
  }

  @Get('vendors')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listVendors(@Param('workspaceId') workspaceId: string) {
    return this.vendors.list(workspaceId)
  }

  @Post('vendors/:vendorId/catalogs')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES }, fileFilter }))
  uploadCatalog(
    @Param('workspaceId') workspaceId: string,
    @Param('vendorId') vendorId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('file is required')
    }
    return this.documents.upload(workspaceId, vendorId, file)
  }

  @Post('vendors/:vendorId/catalogs/scrape')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  scrapeCatalog(
    @Param('workspaceId') workspaceId: string,
    @Param('vendorId') vendorId: string,
    @Body() body: ScrapeCatalogDto,
  ) {
    if (!catalogEnabled()) {
      throw new BadRequestException('Catalog scraping is not enabled for this workspace')
    }
    return this.scrape.startScrape(workspaceId, vendorId, body)
  }

  @Get('vendors/:vendorId/catalogs')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listCatalogs(@Param('workspaceId') workspaceId: string, @Param('vendorId') vendorId: string) {
    return this.documents.listCatalogs(workspaceId, vendorId)
  }

  @Get('vendors/:vendorId/catalogs/:catalogId/items')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listCatalogItems(
    @Param('workspaceId') workspaceId: string,
    @Param('vendorId') vendorId: string,
    @Param('catalogId') catalogId: string,
  ) {
    return this.documents.listItems(workspaceId, vendorId, catalogId)
  }

  @Post('catalog-matches/search')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  searchMatches(@Param('workspaceId') workspaceId: string, @Body() body: CatalogMatchDto) {
    return this.matches.search(workspaceId, body)
  }

  @Post('vendors/:vendorId/catalog-matches/verify')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  verifyMatches(
    @Param('workspaceId') workspaceId: string,
    @Param('vendorId') vendorId: string,
    @Body() body: CatalogMatchDto,
  ) {
    return this.matches.search(workspaceId, { ...body, vendorId })
  }

  @Get('catalog-matches')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listMatches(@Param('workspaceId') workspaceId: string, @Query() query: ListCatalogMatchesQueryDto) {
    return this.matches.listMatches(workspaceId, query)
  }

  @Patch('catalog-matches/:matchId/dismiss')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner', 'admin')
  dismissMatch(
    @Param('workspaceId') workspaceId: string,
    @Param('matchId') matchId: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.matches.dismissMatch(workspaceId, matchId, user.userId)
  }
}
