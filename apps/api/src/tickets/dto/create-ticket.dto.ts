import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class CreateTicketDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50_000)
  transcript!: string
}
