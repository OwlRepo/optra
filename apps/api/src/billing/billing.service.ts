import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { eq } from 'drizzle-orm'
import { db, workspaceSubscriptions } from '@repo/db'
import type { BillingPlan, BillingSummary, CreateCheckoutResponse, PortalResponse } from '@repo/types'
import { EntitlementService } from './entitlement.service'
import { LemonSqueezyClient } from './lemonsqueezy.client'
import { isEntitledStatus, variantIdFor } from './plans'

@Injectable()
export class BillingService {
  constructor(
    private readonly config: ConfigService,
    private readonly entitlement: EntitlementService,
    private readonly ls: LemonSqueezyClient,
  ) {}

  summary(workspaceId: string): Promise<BillingSummary> {
    return this.entitlement.resolve(workspaceId)
  }

  async createCheckout(
    workspaceId: string,
    email: string,
    dto: { plan: BillingPlan; seats?: number },
  ): Promise<CreateCheckoutResponse> {
    if (dto.plan === 'solo' && dto.seats !== undefined) {
      throw new BadRequestException('seats applies to the team plan only')
    }

    const [sub] = await db
      .select({ status: workspaceSubscriptions.status, endsAt: workspaceSubscriptions.endsAt })
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
      .limit(1)
    if (sub && isEntitledStatus(sub.status, sub.endsAt, new Date())) {
      throw new ConflictException('This workspace already has a subscription. Use Manage billing.')
    }

    const variantId = variantIdFor(dto.plan, this.config)
    if (!variantId) throw new ServiceUnavailableException('Billing is not configured')

    const webUrl = this.config.get<string>('WEB_URL') || 'http://localhost:3000'
    return this.ls.createCheckout({
      variantId,
      quantity: dto.plan === 'team' ? (dto.seats ?? 1) : undefined,
      email,
      workspaceId,
      redirectUrl: `${webUrl}/workspaces/${workspaceId}/billing?checkout=success`,
    })
  }

  async portalUrl(workspaceId: string): Promise<PortalResponse> {
    const [sub] = await db
      .select({ lsSubscriptionId: workspaceSubscriptions.lsSubscriptionId })
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
      .limit(1)
    if (!sub) throw new NotFoundException('No subscription for this workspace')
    const { customerPortalUrl } = await this.ls.getSubscription(sub.lsSubscriptionId)
    return { url: customerPortalUrl }
  }
}
