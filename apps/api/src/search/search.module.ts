import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { SearchController } from './search.controller'
import { SearchService } from './search.service'

@Module({
  imports: [AuthModule],
  controllers: [SearchController],
  providers: [SearchService, JwtAuthGuard, WorkspaceMemberGuard],
  exports: [SearchService],
})
export class SearchModule {}
