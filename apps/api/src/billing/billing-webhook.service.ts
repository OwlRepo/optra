import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash } from 'crypto'
import { and, eq, ne } from 'drizzle-orm'
import { billingEvents, db, workspaceSubscriptions, workspaces } from '@repo/db'
import { isEntitledStatus, planForVariant } from './plans'
import { verifySignature } from './webhook-signature'

const SUBSCRIPTION_EVENTS = new Set([
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled',
  'subscription_resumed',
  'subscription_expired',
  'subscription_paused',
  'subscription_unpaused',
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Json = Record<string, unknown>

interface ParsedEvent {
  eventName: string
  customData: Json
  subscriptionId: string
  attributes: Json
  payload: Json
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

class TerminalRejection extends Error {}

@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name)

  constructor(private readonly config: ConfigService) {}

  async handle(rawBody: Buffer, signature: string | undefined): Promise<{ received: true }> {
    const secret = this.config.get<string>('LEMONSQUEEZY_WEBHOOK_SECRET')
    if (!secret) throw new ServiceUnavailableException('Billing is not configured')
    if (!verifySignature(rawBody, signature, secret)) throw new UnauthorizedException('Invalid signature')

    const event = this.parse(rawBody)
    const bodySha256 = createHash('sha256').update(rawBody).digest('hex')

    const [inserted] = await db
      .insert(billingEvents)
      .values({ eventName: event.eventName.slice(0, 64), bodySha256, payload: event.payload })
      .onConflictDoNothing({ target: billingEvents.bodySha256 })
      .returning({ id: billingEvents.id })

    let eventId = inserted?.id
    if (!eventId) {
      const [existing] = await db
        .select({ id: billingEvents.id, processedAt: billingEvents.processedAt })
        .from(billingEvents)
        .where(eq(billingEvents.bodySha256, bodySha256))
        .limit(1)
      if (!existing) throw new InternalServerErrorException('Webhook event could not be recorded')
      if (existing.processedAt) return { received: true }
      eventId = existing.id
    }

    try {
      await this.process(eventId, event)
      return { received: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`Webhook ${event.eventName} failed: ${message}`)
      await db
        .update(billingEvents)
        .set({ lastError: message.slice(0, 2000) })
        .where(eq(billingEvents.id, eventId))
        .catch((stampErr: unknown) => this.logger.error(`Could not store last_error: ${String(stampErr)}`))
      if (err instanceof HttpException) throw err
      throw new InternalServerErrorException('Webhook processing failed')
    }
  }

  private parse(rawBody: Buffer): ParsedEvent {
    let json: unknown
    try {
      json = JSON.parse(rawBody.toString('utf8'))
    } catch {
      throw new BadRequestException('Unexpected webhook body')
    }
    const meta = isObject(json) ? json.meta : undefined
    const data = isObject(json) ? json.data : undefined
    if (
      !isObject(json) ||
      !isObject(meta) ||
      typeof meta.event_name !== 'string' ||
      !isObject(data) ||
      (typeof data.id !== 'string' && typeof data.id !== 'number') ||
      !isObject(data.attributes)
    ) {
      throw new BadRequestException('Unexpected webhook body')
    }
    return {
      eventName: meta.event_name,
      customData: isObject(meta.custom_data) ? meta.custom_data : {},
      subscriptionId: String(data.id),
      attributes: data.attributes,
      payload: json,
    }
  }

  private async process(eventId: string, event: ParsedEvent): Promise<void> {
    if (!SUBSCRIPTION_EVENTS.has(event.eventName)) {
      await db.update(billingEvents).set({ processedAt: new Date(), lastError: null }).where(eq(billingEvents.id, eventId))
      return
    }
    try {
      await this.upsert(eventId, event)
    } catch (err) {
      if (!(err instanceof TerminalRejection)) throw err
      this.logger.warn(`Webhook ${event.eventName} rejected: ${err.message}`)
      await db
        .update(billingEvents)
        .set({ processedAt: new Date(), lastError: err.message })
        .where(eq(billingEvents.id, eventId))
    }
  }

  private async upsert(eventId: string, event: ParsedEvent): Promise<void> {
    const { attributes } = event
    const expectedStore = this.config.get<string>('LEMONSQUEEZY_STORE_ID')
    if (!expectedStore || String(attributes.store_id) !== expectedStore) {
      throw new TerminalRejection('store_id mismatch')
    }
    const plan = planForVariant(attributes.variant_id as string | number | null | undefined, this.config)
    if (!plan) throw new TerminalRejection('unknown variant')

    const workspaceId = event.customData.workspace_id
    if (typeof workspaceId !== 'string' || !UUID_RE.test(workspaceId)) {
      throw new TerminalRejection('missing workspace_id in custom_data')
    }
    const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1)
    if (!workspace) throw new TerminalRejection('unknown workspace')

    const [elsewhere] = await db
      .select({ id: workspaceSubscriptions.id })
      .from(workspaceSubscriptions)
      .where(and(eq(workspaceSubscriptions.lsSubscriptionId, event.subscriptionId), ne(workspaceSubscriptions.workspaceId, workspaceId)))
      .limit(1)
    if (elsewhere) throw new TerminalRejection('subscription belongs to another workspace')

    const lsUpdatedAt = toDate(attributes.updated_at)
    if (!lsUpdatedAt) throw new Error('webhook attributes.updated_at is missing or invalid')
    const item = isObject(attributes.first_subscription_item) ? attributes.first_subscription_item : {}
    const quantity = typeof item.quantity === 'number' ? item.quantity : 1
    const values = {
      lsSubscriptionId: event.subscriptionId,
      lsCustomerId: String(attributes.customer_id ?? ''),
      lsVariantId: String(attributes.variant_id),
      plan,
      status: String(attributes.status ?? ''),
      seats: plan === 'team' ? quantity : 1,
      renewsAt: toDate(attributes.renews_at),
      endsAt: toDate(attributes.ends_at),
      lsUpdatedAt,
      updatedAt: new Date(),
    }

    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          lsSubscriptionId: workspaceSubscriptions.lsSubscriptionId,
          status: workspaceSubscriptions.status,
          endsAt: workspaceSubscriptions.endsAt,
          lsUpdatedAt: workspaceSubscriptions.lsUpdatedAt,
        })
        .from(workspaceSubscriptions)
        .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
        .for('update')
        .limit(1)

      let rejection: string | null = null
      const sameSubscription = current?.lsSubscriptionId === event.subscriptionId
      if (current && !sameSubscription && isEntitledStatus(current.status, current.endsAt, new Date())) {
        rejection = 'workspace already has an active subscription'
      } else if (!(current && sameSubscription && lsUpdatedAt.getTime() < current.lsUpdatedAt.getTime())) {
        await tx
          .insert(workspaceSubscriptions)
          .values({ workspaceId, ...values })
          .onConflictDoUpdate({ target: workspaceSubscriptions.workspaceId, set: values })
      }

      await tx
        .update(billingEvents)
        .set({ processedAt: new Date(), lastError: rejection })
        .where(eq(billingEvents.id, eventId))
    })
  }
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
