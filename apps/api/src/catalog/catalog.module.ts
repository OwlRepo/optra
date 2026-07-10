import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { CatalogController } from './catalog.controller'
import { VendorsService } from './vendors.service'
import { CatalogDocumentsService } from './catalog-documents.service'
import { CatalogParseService } from './catalog-parse.service'
import { CatalogParseProcessor } from './catalog-parse.processor'
import { CatalogScrapeService } from './catalog-scrape.service'
import { CatalogScrapeProcessor } from './catalog-scrape.processor'
import { CatalogImageService } from './catalog-image.service'
import { CatalogExtractionService } from './catalog-extraction.service'
import { CatalogMatchService } from './catalog-match.service'
import { StorageModule } from '../storage/storage.module'

@Module({
  imports: [
    StorageModule,
    BullModule.registerQueue({ name: 'catalog-parse-queue' }),
    BullModule.registerQueue({ name: 'catalog-scrape-queue' }),
  ],
  controllers: [CatalogController],
  providers: [
    VendorsService,
    CatalogDocumentsService,
    CatalogParseService,
    CatalogParseProcessor,
    CatalogScrapeService,
    CatalogScrapeProcessor,
    CatalogImageService,
    CatalogExtractionService,
    CatalogMatchService,
  ],
  exports: [CatalogDocumentsService],
})
export class CatalogModule {}
