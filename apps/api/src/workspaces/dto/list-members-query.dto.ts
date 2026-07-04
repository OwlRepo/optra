import { IsIn, IsOptional } from 'class-validator'
import { OffsetQueryDto } from '../../common/dto/offset-query.dto'

export class ListMembersQueryDto extends OffsetQueryDto {
  @IsOptional()
  @IsIn(['owner', 'admin', 'member'])
  role?: 'owner' | 'admin' | 'member'
}
