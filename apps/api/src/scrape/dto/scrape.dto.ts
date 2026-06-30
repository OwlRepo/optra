import { Type } from 'class-transformer'
import { IsArray, IsInt, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator'

export class ScrapeDto {
  @IsUrl()
  url: string

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  includePrefixes?: string[]
}
