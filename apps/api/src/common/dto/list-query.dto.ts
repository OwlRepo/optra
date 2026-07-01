import { IsNumberString, IsOptional, IsString, Matches } from 'class-validator'

export class ListQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string

  @IsOptional()
  @IsNumberString()
  @Matches(/^(?:[1-9]\d?|100)$/)
  limit?: number
}
