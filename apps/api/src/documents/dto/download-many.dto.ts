import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator'

export class DownloadManyDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  documentIds: string[]
}
