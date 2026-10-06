import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator'

// Plain decimal string, as the numeric columns hold it: no separators, no
// currency symbol, no exponent. Bounded so a pasted blob cannot reach Postgres.
const DECIMAL = /^-?\d{1,15}(\.\d{1,8})?$/
const DECIMAL_MESSAGE = 'must be a plain decimal number such as "10" or "5.25"'

export class ReviewLineDto {
  // Present: an existing line of this document. Absent: a new line.
  @IsOptional()
  @IsUUID()
  id?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sku?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null

  @IsOptional()
  @IsString()
  @Matches(DECIMAL, { message: `quantity ${DECIMAL_MESSAGE}` })
  quantity?: string | null

  @IsOptional()
  @IsString()
  @Matches(DECIMAL, { message: `unitPrice ${DECIMAL_MESSAGE}` })
  unitPrice?: string | null

  @IsOptional()
  @IsString()
  @Matches(DECIMAL, { message: `lineTotal ${DECIMAL_MESSAGE}` })
  lineTotal?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(20)
  uom?: string | null

  @IsOptional()
  @IsString()
  @Matches(DECIMAL, { message: `quantityReceived ${DECIMAL_MESSAGE}` })
  quantityReceived?: string | null

  @IsOptional()
  @IsString()
  @Matches(DECIMAL, { message: `quantityAccepted ${DECIMAL_MESSAGE}` })
  quantityAccepted?: string | null

  @IsOptional()
  @IsString()
  @Matches(DECIMAL, { message: `quantityRejected ${DECIMAL_MESSAGE}` })
  quantityRejected?: string | null
}

export class ReviewDocumentDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReviewLineDto)
  lines!: ReviewLineDto[]
}
