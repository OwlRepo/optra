import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { WorkspaceMemberContext } from '../guards/workspace-member.guard'

export const CurrentWorkspaceMember = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): WorkspaceMemberContext => {
    const req = ctx.switchToHttp().getRequest()
    return req.workspaceMember
  },
)
