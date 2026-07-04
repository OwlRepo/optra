import { IsIn, IsOptional } from 'class-validator'
import { OffsetQueryDto } from '../../common/dto/offset-query.dto'

export class ListScrapeRunsQueryDto extends OffsetQueryDto {
  @IsOptional()
  @IsIn(['queued', 'running', 'completed', 'failed'])
  status?: 'queued' | 'running' | 'completed' | 'failed'
}
