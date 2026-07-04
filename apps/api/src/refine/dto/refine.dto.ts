import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class RefineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text!: string
}
