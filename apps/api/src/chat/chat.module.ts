import { Module } from '@nestjs/common'
import { ChatService } from './chat.service'
import { ChatController } from './chat.controller'
import { AuthModule } from '../auth/auth.module'
import { CacheModule } from '../cache/cache.module'
import { LimitsModule } from '../limits/limits.module'

@Module({
  imports: [AuthModule, CacheModule, LimitsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
