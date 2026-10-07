import { BadRequestException, Controller, Headers, HttpCode, HttpStatus, Post, Req, type RawBodyRequest } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import type { Request } from 'express'
import { BillingWebhookService } from './billing-webhook.service'

@Controller('billing/webhooks')
export class BillingWebhookController {
  constructor(private readonly webhook: BillingWebhookService) {}

  // No auth guards: the HMAC signature over the raw bytes is the authentication.
  @Post('lemonsqueezy')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  receive(@Req() req: RawBodyRequest<Request>, @Headers('x-signature') signature?: string) {
    if (!req.rawBody) throw new BadRequestException('Missing body')
    return this.webhook.handle(req.rawBody, signature)
  }
}
