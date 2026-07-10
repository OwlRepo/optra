import { IsIn, IsOptional, IsUUID } from 'class-validator'

export class ListCatalogMatchesQueryDto {
  @IsOptional()
  @IsUUID()
  vendorId?: string

  @IsOptional()
  @IsIn(['open', 'dismissed'])
  status?: 'open' | 'dismissed'
}
