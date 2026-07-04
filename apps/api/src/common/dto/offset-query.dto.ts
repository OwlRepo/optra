import { IsIn, IsNumberString, IsOptional, IsString, Matches, MaxLength } from 'class-validator'

/**
 * Base query for offset-paginated admin tables (page jump / first / last /
 * page-size + search + sort). Per-domain DTOs extend this to add their own
 * filter fields (e.g. `status`, `role`). Bounds are clamped again in
 * `resolveOffsetPage()`, but validating here gives callers clear 400s.
 */
export class OffsetQueryDto {
  @IsOptional()
  @IsNumberString()
  @Matches(/^\d+$/)
  page?: string

  @IsOptional()
  @IsNumberString()
  @Matches(/^(?:[1-9]\d?|100)$/)
  pageSize?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sort?: string

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc'
}
