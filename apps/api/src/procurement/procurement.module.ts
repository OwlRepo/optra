import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { ProcurementController } from './procurement.controller'
import { ProcurementDocumentsService } from './procurement-documents.service'
import { ProcurementParseService } from './procurement-parse.service'
import { ProcurementParseProcessor } from './procurement-parse.processor'
import { ComparisonService } from './comparison.service'
import { StorageModule } from '../storage/storage.module'
import { StructuredQueryModule } from '../structured-query/structured-query.module'

@Module({
  imports: [StorageModule, StructuredQueryModule, BullModule.registerQueue({ name: 'procurement-parse-queue' })],
  controllers: [ProcurementController],
  providers: [ProcurementDocumentsService, ProcurementParseService, ProcurementParseProcessor, ComparisonService],
  exports: [ProcurementDocumentsService],
})
export class ProcurementModule {}
