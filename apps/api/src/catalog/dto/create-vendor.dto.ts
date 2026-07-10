import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateVendorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name: string

  @IsOptional()
  @IsString()
  contactInfo?: string
}
