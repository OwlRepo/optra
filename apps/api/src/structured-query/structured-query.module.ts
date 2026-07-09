import { Module } from '@nestjs/common'
import { StructuredQueryService } from './structured-query.service'
import { DuckDbQueryService } from './duckdb-query.service'
import { StorageModule } from '../storage/storage.module'

@Module({
  imports: [StorageModule],
  providers: [StructuredQueryService, DuckDbQueryService],
  // DuckDbQueryService additionally exported for ProcurementModule's
  // comparison.service.ts, which reuses this same sandboxed execution
  // engine for a fixed (non-LLM-generated) comparison query.
  exports: [StructuredQueryService, DuckDbQueryService],
})
export class StructuredQueryModule {}
