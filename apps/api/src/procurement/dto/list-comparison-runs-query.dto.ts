import { IsIn, IsOptional, IsUUID } from 'class-validator'
import { OffsetQueryDto } from '../../common/dto/offset-query.dto'

/**
 * Run history (S7). Offset paging per the convention in
 * docs/ai/contracts/api-contracts.md:27-44.
 *
 * The pair filter is the point of the endpoint rather than a convenience: the
 * question a reviewer actually asks is "what did the previous comparison of
 * THIS purchase order and invoice say?". `comparison_runs_pair_status_idx`
 * already serves it, so no migration.
 */
export class ListComparisonRunsQueryDto extends OffsetQueryDto {
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string

  @IsOptional()
  @IsUUID()
  invoiceId?: string

  // Mirrors `comparison_run_status`. `queued` is unused until S8 queues runs,
  // but listing it costs nothing and avoids a second edit then.
  @IsOptional()
  @IsIn(['queued', 'running', 'succeeded', 'failed'])
  status?: 'queued' | 'running' | 'succeeded' | 'failed'
}
