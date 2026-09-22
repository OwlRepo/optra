import {
  IsISO4217CurrencyCode,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator'

/**
 * One agreed price, with the window it applies to.
 *
 * `unitPrice` arrives as a STRING and is stored as one: drizzle maps `numeric`
 * to a JS string, and handing Postgres a JS number would round a price on the
 * way in. Same rule the seed states at the top of scripts/seed/data/procurement.ts.
 */
export class CreatePriceTermDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  sku: string

  // Optional, and absent means the agreement stated no unit — never a unit of
  // its own. POLICY v1 #4: units are captured, never converted.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  uom?: string

  @IsString()
  @Matches(/^\d{1,12}(\.\d{1,6})?$/, {
    message: 'unitPrice must be a non-negative decimal number, given as a string',
  })
  unitPrice: string

  // Validated here, uppercased in the service — `IsISO4217CurrencyCode` is
  // case-insensitive and the global ValidationPipe runs without `transform`,
  // so a @Transform would never fire. Same trap S3b hit on the PO upload.
  @IsISO4217CurrencyCode()
  currency: string

  @IsISO8601()
  effectiveFrom: string

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  sourceReference?: string
}
