import { IsIn, IsOptional, IsUUID } from 'class-validator'
import { OffsetQueryDto } from '../../common/dto/offset-query.dto'

// Offset paging, per the convention at docs/ai/contracts/api-contracts.md:27-44
// — a review queue is an admin table, so it wants page jump and first/last
// rather than the keyset cursor kept for infinite scroll. `q`/`sort`/`sortDir`
// come along from the base and are simply not read here, same as the other
// five offset endpoints.
export class ListDiscrepanciesQueryDto extends OffsetQueryDto {
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string

  @IsOptional()
  @IsUUID()
  invoiceId?: string

  @IsOptional()
  @IsIn(['open', 'dismissed'])
  status?: 'open' | 'dismissed'

  // Omitted means "current": the latest succeeded run for each PO/invoice
  // pair. Supply one to read that run's flags instead — how history is read.
  @IsOptional()
  @IsUUID()
  runId?: string
}
