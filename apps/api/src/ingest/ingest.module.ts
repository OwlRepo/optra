import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { IngestProcessor } from './ingest.processor'
import { IngestService } from './ingest.service'

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'ingest-queue',
    }),
  ],
  providers: [IngestProcessor, IngestService],
  exports: [IngestService],
})
export class IngestModule {}
