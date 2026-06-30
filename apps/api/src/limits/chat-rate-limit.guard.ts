import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { RateLimitService } from './rate-limit.service'

@Injectable()
export class ChatRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: RateLimitService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{
      user: { userId: string }
      params: { workspaceId: string }
    }>()

    await this.rateLimit.check(req.user.userId, req.params.workspaceId)
    return true
  }
}
