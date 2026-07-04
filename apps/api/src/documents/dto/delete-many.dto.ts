import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator'

export class DeleteManyDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  documentIds: string[]
}
