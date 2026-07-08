import { Module } from '@nestjs/common'
import { StructuredQueryService } from './structured-query.service'
import { DuckDbQueryService } from './duckdb-query.service'
import { StorageModule } from '../storage/storage.module'

@Module({
  imports: [StorageModule],
  providers: [StructuredQueryService, DuckDbQueryService],
  exports: [StructuredQueryService],
})
export class StructuredQueryModule {}
