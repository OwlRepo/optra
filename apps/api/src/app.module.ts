import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { BullModule } from '@nestjs/bull'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { DocumentsModule } from './documents/documents.module'
import { IngestModule } from './ingest/ingest.module'
import { ChatModule } from './chat/chat.module'
import { AuthModule } from './auth/auth.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
    DocumentsModule,
    IngestModule,
    ChatModule,
    AuthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
