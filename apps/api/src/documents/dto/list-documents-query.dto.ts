import { IsIn, IsOptional } from 'class-validator'
import { OffsetQueryDto } from '../../common/dto/offset-query.dto'

export class ListDocumentsQueryDto extends OffsetQueryDto {
  @IsOptional()
  @IsIn(['pending', 'processing', 'done', 'failed'])
  status?: 'pending' | 'processing' | 'done' | 'failed'
}
