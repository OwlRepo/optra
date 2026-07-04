import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { CurrentUser, type CurrentUserContext } from '../auth/decorators/current-user.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { CreateTicketDto } from './dto/create-ticket.dto'
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto'
import { UpdateTicketDto } from './dto/update-ticket.dto'
import { TicketsService } from './tickets.service'

@Controller('workspaces/:workspaceId/tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  async create(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateTicketDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.ticketsService.create(workspaceId, dto.transcript)
    response.status(result.statusCode)
    return result.ticket
  }

  @Get()
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  list(@Param('workspaceId') workspaceId: string, @Query() query: ListTicketsQueryDto) {
    return this.ticketsService.list(workspaceId, query)
  }

  @Get(':ticketId/transcript.pdf')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  async downloadTranscript(
    @Param('workspaceId') workspaceId: string,
    @Param('ticketId') ticketId: string,
    @Res() res: Response,
  ) {
    const { title, buffer } = await this.ticketsService.getTranscriptPdf(workspaceId, ticketId)

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${title.replace(/["\r\n]/g, '_')}"`,
      'Content-Length': String(buffer.length),
    })
    res.send(buffer)
  }

  @Get(':ticketId')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  getOne(@Param('workspaceId') workspaceId: string, @Param('ticketId') ticketId: string) {
    return this.ticketsService.getOne(workspaceId, ticketId)
  }

  @Patch(':ticketId')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('ticketId') ticketId: string,
    @CurrentUser() user: CurrentUserContext,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.ticketsService.update(workspaceId, ticketId, user.userId, dto)
  }
}
