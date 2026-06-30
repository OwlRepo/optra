import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import { ChatService } from './chat.service'
import { CurrentUser, type CurrentUserContext } from '../auth/decorators/current-user.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { ChatDto } from './dto/chat.dto'
import { ChatRateLimitGuard } from '../limits/chat-rate-limit.guard'

@Controller('workspaces/:workspaceId/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, ChatRateLimitGuard)
  async chat(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: CurrentUserContext,
    @Body() dto: ChatDto,
    @Res() res: Response,
  ) {
    let onComplete: ((fullText: string) => Promise<void>) | undefined
    let fullText = ''

    try {
      const result = await this.chatService.answer(
        workspaceId,
        user.userId,
        dto.message,
        dto.sessionId,
      )
      onComplete = result.onComplete

      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('X-Chat-Sources', encodeURIComponent(JSON.stringify(result.sources)))
      res.setHeader('X-Chat-Session-Id', result.sessionId)
      res.setHeader('X-Chat-Cache', result.cacheStatus)

      const chunks: string[] = []

      for await (const token of result.stream) {
        chunks.push(token)
        res.write(token)
      }

      fullText = chunks.join('')
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }

      console.error('Chat route failed', error)
      res.write('Assistant could not generate response right now.')
      res.end()
      return
    }

    try {
      await onComplete?.(fullText)
    } catch (error) {
      console.error('Chat completion persistence failed', error)
    }

    res.end()
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  listSessions(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.chatService.listSessions(workspaceId, user.userId)
  }

  @Get('sessions/:sessionId/messages')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  getMessages(
    @Param('workspaceId') workspaceId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    return this.chatService.getMessages(workspaceId, user.userId, sessionId)
  }
}
