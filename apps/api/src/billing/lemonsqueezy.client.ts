import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

const TIMEOUT_MS = 10_000
const UNAVAILABLE = 'Billing provider unavailable. Try again in a moment.'

interface Credentials {
  apiUrl: string
  apiKey: string
  storeId: string
}

@Injectable()
export class LemonSqueezyClient {
  private readonly logger = new Logger(LemonSqueezyClient.name)

  constructor(private readonly config: ConfigService) {}

  async createCheckout(input: {
    variantId: string
    quantity?: number
    email: string
    workspaceId: string
    redirectUrl: string
  }): Promise<{ url: string }> {
    const creds = this.credentials()
    const body = {
      data: {
        type: 'checkouts',
        attributes: {
          product_options: { redirect_url: input.redirectUrl },
          checkout_data: {
            email: input.email,
            custom: { workspace_id: input.workspaceId },
            ...(input.quantity
              ? { variant_quantities: [{ variant_id: Number(input.variantId), quantity: input.quantity }] }
              : {}),
          },
        },
        relationships: {
          store: { data: { type: 'stores', id: creds.storeId } },
          variant: { data: { type: 'variants', id: input.variantId } },
        },
      },
    }
    const json = await this.request(creds, 'POST', '/v1/checkouts', body)
    const url = pick(json, ['data', 'attributes', 'url'])
    if (typeof url !== 'string' || !url) this.fail('checkout response lacked data.attributes.url')
    return { url }
  }

  async getSubscription(lsSubscriptionId: string): Promise<{ customerPortalUrl: string }> {
    const creds = this.credentials()
    const json = await this.request(creds, 'GET', `/v1/subscriptions/${encodeURIComponent(lsSubscriptionId)}`)
    const url = pick(json, ['data', 'attributes', 'urls', 'customer_portal'])
    if (typeof url !== 'string' || !url) this.fail('subscription response lacked urls.customer_portal')
    return { customerPortalUrl: url }
  }

  private credentials(): Credentials {
    const apiKey = this.config.get<string>('LEMONSQUEEZY_API_KEY')
    const storeId = this.config.get<string>('LEMONSQUEEZY_STORE_ID')
    if (!apiKey || !storeId) throw new ServiceUnavailableException('Billing is not configured')
    return {
      apiUrl: (this.config.get<string>('LEMONSQUEEZY_API_URL') || 'https://api.lemonsqueezy.com').replace(/\/+$/, ''),
      apiKey,
      storeId,
    }
  }

  private async request(creds: Credentials, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let res: Response
    try {
      res = await fetch(`${creds.apiUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          Authorization: `Bearer ${creds.apiKey}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      this.fail(`${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      this.fail(`${method} ${path} answered ${res.status}: ${text.slice(0, 500)}`)
    }
    try {
      return await res.json()
    } catch {
      return this.fail(`${method} ${path} returned a non-JSON body`)
    }
  }

  private fail(detail: string): never {
    this.logger.warn(`Lemon Squeezy: ${detail}`)
    throw new BadGatewayException(UNAVAILABLE)
  }
}

function pick(value: unknown, path: string[]): unknown {
  let cur: unknown = value
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}
