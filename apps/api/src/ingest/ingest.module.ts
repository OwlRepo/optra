import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { IngestProcessor } from './ingest.processor'
import { IngestService } from './ingest.service'
import { StorageModule } from '../storage/storage.module'
import { CacheModule } from '../cache/cache.module'
import { EventsModule } from '../events/events.module'

@Module({
  imports: [
    StorageModule,
    CacheModule,
    EventsModule,
    BullModule.registerQueue({
      name: 'ingest-queue',
    }),
  ],
  providers: [IngestProcessor, IngestService],
  exports: [IngestService],
})
export class IngestModule {}
