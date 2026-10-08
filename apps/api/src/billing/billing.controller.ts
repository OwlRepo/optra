import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common'
import { CurrentUser, type CurrentUserContext } from '../auth/decorators/current-user.decorator'
import { Roles } from '../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { BillingService } from './billing.service'
import { CreateCheckoutDto } from './dto/create-checkout.dto'

@Controller('workspaces/:workspaceId/billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  summary(@Param('workspaceId') workspaceId: string) {
    return this.billing.summary(workspaceId)
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner')
  checkout(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: CurrentUserContext,
    @Body() dto: CreateCheckoutDto,
  ) {
    return this.billing.createCheckout(workspaceId, user.email, dto)
  }

  @Post('portal')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard, RolesGuard)
  @Roles('owner')
  portal(@Param('workspaceId') workspaceId: string) {
    return this.billing.portalUrl(workspaceId)
  }
}
