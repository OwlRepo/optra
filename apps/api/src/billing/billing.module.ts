import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { BillingWebhookController } from './billing-webhook.controller'
import { BillingWebhookService } from './billing-webhook.service'
import { BillingController } from './billing.controller'
import { BillingService } from './billing.service'
import { EntitlementService } from './entitlement.service'
import { LemonSqueezyClient } from './lemonsqueezy.client'
import { BillingGateService } from './billing-gate.service'
import { UsageLedgerService } from './usage-ledger.service'

@Module({
  imports: [AuthModule],
  controllers: [BillingController, BillingWebhookController],
  providers: [
    BillingService,
    BillingWebhookService,
    EntitlementService,
    UsageLedgerService,
    BillingGateService,
    LemonSqueezyClient,
    JwtAuthGuard,
    WorkspaceMemberGuard,
    RolesGuard,
  ],
  exports: [EntitlementService, BillingGateService],
})
export class BillingModule {}
