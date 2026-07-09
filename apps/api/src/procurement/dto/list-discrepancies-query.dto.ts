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
}
