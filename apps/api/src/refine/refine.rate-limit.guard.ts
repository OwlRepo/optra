import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { RateLimitService } from '../limits/rate-limit.service'

@Injectable()
export class RefineRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: RateLimitService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{
      user: { userId: string }
    }>()

    await this.rateLimit.checkRefineDaily(req.user.userId)
    return true
  }
}
