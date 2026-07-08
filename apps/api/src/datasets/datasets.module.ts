import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { DatasetsController } from './datasets.controller'
import { DatasetsService } from './datasets.service'
import { DatasetProfilingService } from './dataset-profiling.service'
import { DatasetProfilingProcessor } from './dataset-profiling.processor'
import { StorageModule } from '../storage/storage.module'

@Module({
  imports: [
    StorageModule,
    BullModule.registerQueue({ name: 'dataset-profiling-queue' }),
  ],
  controllers: [DatasetsController],
  providers: [DatasetsService, DatasetProfilingService, DatasetProfilingProcessor],
  exports: [DatasetsService, DatasetProfilingService],
})
export class DatasetsModule {}
