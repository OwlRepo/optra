import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { db, workspaceMembers, type WorkspaceMember } from '@repo/db'

export interface WorkspaceMemberContext {
  workspaceId: string
  role: WorkspaceMember['role']
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

@Injectable()
export class WorkspaceMemberGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest()
    const workspaceId: string | undefined = req.params?.workspaceId

    if (!workspaceId) {
      throw new InternalServerErrorException(
        'WorkspaceMemberGuard requires a :workspaceId route param',
      )
    }

    // Malformed IDs must look like "no access", not a raw DB error — never hit Postgres with a non-UUID
    if (!UUID_RE.test(workspaceId)) {
      throw new ForbiddenException('Not a member of this workspace')
    }

    // Must run after JwtAuthGuard in @UseGuards() order — relies on req.user being set
    const userId: string | undefined = req.user?.userId
    if (!userId) {
      throw new ForbiddenException('Not authenticated')
    }

    const [member] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1)

    if (!member) {
      throw new ForbiddenException('Not a member of this workspace')
    }

    req.workspaceMember = { workspaceId, role: member.role } satisfies WorkspaceMemberContext

    return true
  }
}
