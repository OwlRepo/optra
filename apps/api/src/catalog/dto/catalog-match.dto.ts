import { IsOptional, IsUUID } from 'class-validator'

export class CatalogMatchDto {
  @IsOptional()
  @IsUUID()
  purchaseOrderLineItemId?: string

  @IsOptional()
  @IsUUID()
  invoiceLineItemId?: string
}
