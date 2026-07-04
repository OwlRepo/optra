import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class SaveRefinedMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  originalText!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  refinedText!: string
}
