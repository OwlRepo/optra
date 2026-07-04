import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common'
import { RefineEmptyError, RefineRefusalError } from '@repo/ai'
import { CurrentUser, type CurrentUserContext } from '../auth/decorators/current-user.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { RateLimitService } from '../limits/rate-limit.service'
import { RefineDto } from './dto/refine.dto'
import { SaveRefinedMessageDto } from './dto/save-refined-message.dto'
import { RefineRateLimitGuard } from './refine.rate-limit.guard'
import { RefineService } from './refine.service'

@Controller('workspaces/:workspaceId/refine')
export class RefineController {
  constructor(
    private readonly refineService: RefineService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RefineRateLimitGuard)
  async refine(@Body() dto: RefineDto) {
    try {
      return await this.refineService.refine(dto.text)
    } catch (error) {
      if (error instanceof RefineEmptyError) {
        throw new UnprocessableEntityException('Refine produced no output. Try rephrasing.')
      }
      if (error instanceof RefineRefusalError) {
        throw new UnprocessableEntityException('Refine could not process this message. Try rephrasing.')
      }
      throw error
    }
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  status(@CurrentUser() user: CurrentUserContext) {
    return this.rateLimit.getRefineStatus(user.userId)
  }

  @Post('saved')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  saveRefinedMessage(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: CurrentUserContext,
    @Body() dto: SaveRefinedMessageDto,
  ) {
    return this.refineService.saveRefinedMessage(workspaceId, user.userId, dto)
  }

  @Get('saved')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  async listSavedRefinedMessages(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: CurrentUserContext,
  ) {
    const items = await this.refineService.listSavedRefinedMessages(workspaceId, user.userId)
    return { items }
  }
}
