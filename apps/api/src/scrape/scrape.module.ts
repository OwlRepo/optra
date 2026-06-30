import { BullModule } from '@nestjs/bull'
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { IngestModule } from '../ingest/ingest.module'
import { StorageModule } from '../storage/storage.module'
import { ScrapeController } from './scrape.controller'
import { ScrapeProcessor } from './scrape.processor'
import { ScrapeService } from './scrape.service'

@Module({
  imports: [
    AuthModule,
    StorageModule,
    IngestModule,
    BullModule.registerQueue({
      name: 'scrape-queue',
    }),
  ],
  controllers: [ScrapeController],
  providers: [ScrapeService, ScrapeProcessor, JwtAuthGuard, WorkspaceMemberGuard, RolesGuard],
  exports: [ScrapeService],
})
export class ScrapeModule {}
