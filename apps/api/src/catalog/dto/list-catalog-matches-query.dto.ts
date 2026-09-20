import { IsIn, IsOptional, IsUUID } from 'class-validator'

export class ListCatalogMatchesQueryDto {
  @IsOptional()
  @IsUUID()
  vendorId?: string

  // The Catalog Matches page is reached from a specific discrepancy line, but
  // had no way to ask for that line's matches, so it listed every match in the
  // workspace. Both optional: omitted keeps the previous behaviour.
  @IsOptional()
  @IsUUID()
  poLineItemId?: string

  @IsOptional()
  @IsUUID()
  invoiceLineItemId?: string

  @IsOptional()
  @IsIn(['open', 'dismissed'])
  status?: 'open' | 'dismissed'
}
