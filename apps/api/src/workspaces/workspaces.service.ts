import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { and, asc, count, desc, eq, gt, ilike, isNull, lt, or, sql } from 'drizzle-orm'
import { randomBytes } from 'crypto'
import {
  buildOffsetResult,
  db,
  decodeCursor,
  encodeCursor,
  invitations,
  resolveOffsetPage,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { NotificationsService } from '../notifications/notifications.service'
import { ListQueryDto } from '../common/dto/list-query.dto'
import { ListMembersQueryDto } from './dto/list-members-query.dto'

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

@Injectable()
export class WorkspacesService {
  constructor(
    private notifications: NotificationsService,
    private config: ConfigService,
  ) {}

  async create(userId: string, name: string) {
    return db.transaction(async (tx) => {
      const [workspace] = await tx
        .insert(workspaces)
        .values({ name, ownerId: userId })
        .returning()

      await tx.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId,
        role: 'owner',
      })

      return workspace
    })
  }

  async listForUser(
    userId: string,
    query: Pick<ListQueryDto, 'cursor' | 'limit'>,
  ) {
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100)
    const cursor = query.cursor ? decodeCursor(query.cursor) : null
    const createdAtMs = sql<number>`floor(extract(epoch from ${workspaces.createdAt}) * 1000)`

    const rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        ownerId: workspaces.ownerId,
        createdAt: workspaces.createdAt,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          cursor
            ? or(
                lt(createdAtMs, Number(cursor.k[0])),
                and(eq(createdAtMs, Number(cursor.k[0])), lt(workspaces.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(createdAtMs), desc(workspaces.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = rows.slice(0, limit)
    const last = items.at(-1)

    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor({ k: [last.createdAt.getTime()], id: last.id })
          : null,
    }
  }

  async getOne(workspaceId: string) {
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1)

    if (!workspace) {
      throw new NotFoundException('Workspace not found')
    }

    return workspace
  }

  async invite(workspaceId: string, email: string): Promise<{ message: string }> {
    const normalizedEmail = this.normalizeEmail(email)
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await db.insert(invitations).values({
      workspaceId,
      email: normalizedEmail,
      token,
      expiresAt,
    })

    const inviteUrl = `${this.config.get<string>('WEB_URL') ?? 'http://localhost:3000'}/invite/${token}`
    await this.notifications.sendInvite(normalizedEmail, inviteUrl)

    return { message: 'Invite sent' }
  }

  async acceptInvite(userId: string, userEmail: string, token: string) {
    const [invite] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.token, token))
      .limit(1)

    if (!invite) {
      throw new NotFoundException('Invitation not found')
    }

    if (invite.acceptedAt) {
      throw new BadRequestException('Invitation already accepted')
    }

    if (invite.expiresAt <= new Date()) {
      throw new BadRequestException('Invitation expired')
    }

    if (this.normalizeEmail(invite.email) !== this.normalizeEmail(userEmail)) {
      throw new BadRequestException('Invitation email does not match logged-in user')
    }

    return db.transaction(async (tx) => {
      const [existingMember] = await tx
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, invite.workspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        )
        .limit(1)

      if (!existingMember) {
        await tx.insert(workspaceMembers).values({
          workspaceId: invite.workspaceId,
          userId,
          role: 'member',
        })
      }

      await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(invitations.id, invite.id))

      return this.getWorkspaceOrThrow(tx, invite.workspaceId)
    })
  }

  async removeMember(workspaceId: string, targetUserId: string): Promise<{ message: string }> {
    const [member] = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, targetUserId),
        ),
      )
      .limit(1)

    if (!member) {
      throw new NotFoundException('Workspace member not found')
    }

    if (member.role === 'owner') {
      const owners = await db
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.role, 'owner'),
          ),
        )

      if (owners.length <= 1) {
        throw new ForbiddenException('Cannot remove the last owner')
      }
    }

    await db.delete(workspaceMembers).where(eq(workspaceMembers.id, member.id))

    return { message: 'Member removed' }
  }

  async listMembers(
    workspaceId: string,
    query: Pick<ListMembersQueryDto, 'page' | 'pageSize' | 'q' | 'role'>,
  ) {
    const { page, pageSize, offset } = resolveOffsetPage(query.page, query.pageSize)

    const filters = [eq(workspaceMembers.workspaceId, workspaceId)]
    if (query.role) {
      filters.push(eq(workspaceMembers.role, query.role))
    }
    const search = query.q?.trim()
    if (search) {
      filters.push(ilike(users.email, `%${search}%`))
    }
    const where = and(...filters)

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(where)

    const items = await db
      .select({
        id: workspaceMembers.id,
        userId: workspaceMembers.userId,
        email: users.email,
        role: workspaceMembers.role,
        joinedAt: workspaceMembers.joinedAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(where)
      .orderBy(desc(workspaceMembers.joinedAt), desc(workspaceMembers.id))
      .limit(pageSize)
      .offset(offset)

    return buildOffsetResult(items, Number(total), page, pageSize)
  }

  private async getWorkspaceOrThrow(client: typeof db | DbTx, workspaceId: string) {
    const [workspace] = await client
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1)

    if (!workspace) {
      throw new NotFoundException('Workspace not found')
    }

    return workspace
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase()
  }
}
