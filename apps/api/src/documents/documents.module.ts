import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { IngestModule } from '../ingest/ingest.module'
import { StorageModule } from '../storage/storage.module'
import { DocumentsController } from './documents.controller'
import { DocumentsService } from './documents.service'

@Module({
  imports: [AuthModule, StorageModule, IngestModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, JwtAuthGuard, WorkspaceMemberGuard, RolesGuard],
  exports: [DocumentsService],
})
export class DocumentsModule {}
