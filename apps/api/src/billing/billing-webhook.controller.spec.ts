import 'reflect-metadata'
import { BadRequestException } from '@nestjs/common'
import { BillingWebhookController } from './billing-webhook.controller'
import type { BillingWebhookService } from './billing-webhook.service'

function controllerWith(handle: jest.Mock = jest.fn()) {
  return new BillingWebhookController({ handle } as unknown as BillingWebhookService)
}

describe('BillingWebhookController', () => {
  it('error: a request without a raw body is BadRequest', () => {
    const handle = jest.fn()

    expect(() => controllerWith(handle).receive({} as never, 'sig')).toThrow(BadRequestException)
    expect(handle).not.toHaveBeenCalled()
  })

  it('edge: the route has no auth guard and is marked SkipThrottle', () => {
    const handler = BillingWebhookController.prototype.receive
    expect(Reflect.getMetadata('__guards__', handler)).toBeUndefined()
    expect(Reflect.getMetadata('__guards__', BillingWebhookController)).toBeUndefined()
    expect(
      Reflect.getMetadata('THROTTLER:SKIPdefault', handler) ?? Reflect.getMetadata('THROTTLER:SKIPdefault', BillingWebhookController),
    ).toBe(true)
  })

  it('happy: the raw body buffer and the signature header reach the service and the answer is {received: true}', async () => {
    const handle = jest.fn().mockResolvedValue({ received: true })
    const rawBody = Buffer.from('{"a":1}')

    await expect(controllerWith(handle).receive({ rawBody } as never, 'abc')).resolves.toEqual({ received: true })
    expect(handle).toHaveBeenCalledWith(rawBody, 'abc')
  })
})
