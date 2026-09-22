import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { ProcurementController } from './procurement.controller'
import { ProcurementDocumentsService } from './procurement-documents.service'
import { ProcurementParseService } from './procurement-parse.service'
import { ProcurementParseProcessor } from './procurement-parse.processor'
import { ProcurementExtractionService } from './procurement-extraction.service'
import { ComparisonService } from './comparison.service'
import { ProcurementCompareService } from './procurement-compare.service'
import { ProcurementCompareProcessor } from './procurement-compare.processor'
import { StorageModule } from '../storage/storage.module'
import { LimitsModule } from '../limits/limits.module'
import { StructuredQueryModule } from '../structured-query/structured-query.module'

@Module({
  imports: [
    StorageModule,
    StructuredQueryModule,
    LimitsModule,
    BullModule.registerQueue({ name: 'procurement-parse-queue' }),
    // Its own queue, not an inline call at the end of the parse job: a
    // comparison spins up a 256MB in-memory DuckDB, and charging that to the
    // parse job's timeout would make a slow comparison look like a failed
    // parse. Name-only, like every other registerQueue here — per-job options
    // live at each `.add()`.
    BullModule.registerQueue({ name: 'procurement-compare-queue' }),
  ],
  controllers: [ProcurementController],
  providers: [
    ProcurementDocumentsService,
    ProcurementParseService,
    ProcurementParseProcessor,
    ProcurementExtractionService,
    ComparisonService,
    ProcurementCompareService,
    ProcurementCompareProcessor,
  ],
  exports: [ProcurementDocumentsService],
})
export class ProcurementModule {}
