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
import { and, eq, ne, sql } from 'drizzle-orm'
import { billingEvents, db, workspaceSubscriptions, workspaces } from '@repo/db'
import { SEATS_MAX, SEATS_MIN, isEntitledStatus, planForVariant, variantIdFor } from './plans'
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

/** Acknowledged with 200: resending the same body can never succeed. */
class TerminalRejection extends Error {}

/** Answered with 500 so Lemon Squeezy resends: a fix on our side makes it succeed. */
class RetryableFailure extends Error {}

const SAFE_PHRASES = /connection terminated|connection timeout|timeout|ECONNREFUSED|ECONNRESET|deadlock detected|too many clients|statement timeout/i

/**
 * Driver errors echo query parameters, which carry the buyer's email. Only the
 * error name, a pg/Node code and a fixed phrase are ever logged or stored.
 */
function describeError(err: unknown): string {
  if (err instanceof RetryableFailure) return err.message
  if (!(err instanceof Error)) return 'Non-error thrown'
  const withCode = err as Error & { code?: unknown; cause?: { code?: unknown } }
  const code = [withCode.code, withCode.cause?.code].find((c): c is string => typeof c === 'string')
  const phrase = SAFE_PHRASES.exec(err.message)?.[0] ?? SAFE_PHRASES.exec(String(withCode.cause ?? ''))?.[0]
  return `${err.name}${code ? ` [${code}]` : ''}: ${phrase ?? 'database or processing error (details withheld)'}`
}

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
      const message = describeError(err)
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

  private hasValidBinding(event: ParsedEvent): boolean {
    const { workspace_id: workspaceId, workspace_sig: workspaceSig } = event.customData
    const secret = this.config.get<string>('LEMONSQUEEZY_WEBHOOK_SECRET')
    return (
      typeof workspaceId === 'string' &&
      UUID_RE.test(workspaceId) &&
      typeof workspaceSig === 'string' &&
      !!secret &&
      verifySignature(Buffer.from(workspaceId, 'utf8'), workspaceSig, secret)
    )
  }

  private async upsert(eventId: string, event: ParsedEvent): Promise<void> {
    const { attributes } = event
    // Our own misconfiguration or an unmapped variant is retryable: a terminal
    // ack here would lose a paid subscription for good.
    const expectedStore = this.config.get<string>('LEMONSQUEEZY_STORE_ID')?.trim()
    if (!expectedStore) throw new RetryableFailure('LEMONSQUEEZY_STORE_ID is not configured')
    if (String(attributes.store_id) !== expectedStore) throw new TerminalRejection('store_id mismatch')
    const plan = planForVariant(attributes.variant_id as string | number | null | undefined, this.config)
    // The store is shared with another app: a subscription event that carries no
    // valid workspace binding and a variant that is not ours is not ours. Only
    // decidable when both variant ids are configured; otherwise stay retryable.
    if (!plan && !this.hasValidBinding(event) && variantIdFor('solo', this.config) && variantIdFor('team', this.config)) {
      throw new TerminalRejection(`foreign event: not an Optra subscription (variant ${String(attributes.variant_id ?? 'none')})`)
    }
    if (!plan) throw new RetryableFailure('unknown variant (not mapped to a plan; check LEMONSQUEEZY_VARIANT_* env)')

    const workspaceId = event.customData.workspace_id
    if (typeof workspaceId !== 'string' || !UUID_RE.test(workspaceId)) {
      throw new TerminalRejection('missing workspace_id in custom_data')
    }
    const secret = this.config.get<string>('LEMONSQUEEZY_WEBHOOK_SECRET') as string
    const workspaceSig = event.customData.workspace_sig
    if (typeof workspaceSig !== 'string' || !verifySignature(Buffer.from(workspaceId, 'utf8'), workspaceSig, secret)) {
      throw new TerminalRejection('workspace binding signature missing or invalid')
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
    const quantity = item.quantity
    if (plan === 'team' && (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < SEATS_MIN || quantity > SEATS_MAX)) {
      throw new TerminalRejection('invalid quantity for the team plan')
    }
    const values = {
      lsSubscriptionId: event.subscriptionId,
      lsCustomerId: String(attributes.customer_id ?? ''),
      lsVariantId: String(attributes.variant_id),
      plan,
      status: String(attributes.status ?? ''),
      seats: plan === 'team' ? (quantity as number) : 1,
      renewsAt: toDate(attributes.renews_at),
      endsAt: toDate(attributes.ends_at),
      lsUpdatedAt,
      updatedAt: new Date(),
    }

    await db.transaction(async (tx) => {
      // Serialises every delivery for this workspace: FOR UPDATE locks nothing
      // when the row does not exist yet, so two first deliveries could race.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`)
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
      if (current && lsUpdatedAt.getTime() < current.lsUpdatedAt.getTime()) {
        rejection = 'stale event: the workspace row is newer'
      } else if (current && !sameSubscription && isEntitledStatus(current.status, current.endsAt, new Date())) {
        rejection = 'workspace already has an active subscription'
      } else {
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
