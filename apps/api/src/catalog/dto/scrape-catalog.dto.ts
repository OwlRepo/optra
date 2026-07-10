import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsUrl, Max, Min } from 'class-validator'

export class ScrapeCatalogDto {
  @IsUrl()
  seedUrl: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  maxDepth?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  maxPages?: number
}
