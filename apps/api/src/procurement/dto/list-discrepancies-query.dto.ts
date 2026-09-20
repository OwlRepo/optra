import { IsIn, IsOptional, IsUUID } from 'class-validator'

export class ListDiscrepanciesQueryDto {
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
