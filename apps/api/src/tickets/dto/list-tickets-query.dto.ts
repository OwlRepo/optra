import { IsIn, IsOptional } from 'class-validator'
import { OffsetQueryDto } from '../../common/dto/offset-query.dto'

export class ListTicketsQueryDto extends OffsetQueryDto {
  @IsOptional()
  @IsIn(['pending', 'processing', 'done', 'failed'])
  status?: 'pending' | 'processing' | 'done' | 'failed'

  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  severity?: 'low' | 'medium' | 'high'

  @IsOptional()
  @IsIn(['useful', 'not_useful'])
  usefulness?: 'useful' | 'not_useful'

  /** Filters to tickets usable as chat reference chunks: done + reviewed + usefulness='useful'. */
  @IsOptional()
  @IsIn(['true', 'false'])
  indexed?: 'true' | 'false'
}
