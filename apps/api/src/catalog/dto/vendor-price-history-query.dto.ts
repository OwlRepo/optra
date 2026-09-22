import { IsOptional, IsString, MaxLength } from 'class-validator'
import { OffsetQueryDto } from '../../common/dto/offset-query.dto'

export class VendorPriceHistoryQueryDto extends OffsetQueryDto {
  // Matched case-insensitively, the way every other SKU comparison in the repo
  // is, because the engine's own match key is `sku::<lower>`.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sku?: string
}
