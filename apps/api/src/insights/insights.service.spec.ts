import { eq } from 'drizzle-orm'
import { db, documents, documentReviewFlags, knowledgeBases, pool, users, workspaceMembers, workspaces } from '@repo/db'
import { InsightsService } from './insights.service'

describe('InsightsService', () => {
  let service: InsightsService
  const prefix = `insights-spec-${Date.now()}-`
  let workspaceId: string
  let userId: string
  let documentId: string

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `${prefix}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    userId = user.id
    const [workspace] = await db.insert(workspaces).values({ name: prefix, ownerId: user.id }).returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
    workspaceId = workspace.id

    const [kb] = await db.insert(knowledgeBases).values({ workspaceId, name: prefix }).returning()
    const [document] = await db
      .insert(documents)
      .values({ workspaceId, knowledgeBaseId: kb.id, title: 'Runbook', status: 'done' })
      .returning()
    documentId = document.id
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    service = new InsightsService()
    await db.delete(documentReviewFlags).where(eq(documentReviewFlags.workspaceId, workspaceId))
  })

  it('lists only open flags for the workspace, newest first', async () => {
    const [older] = await db
      .insert(documentReviewFlags)
      .values({ workspaceId, documentId, reason: 'ticket-mismatch', status: 'open', score: 0.2 })
      .returning()
    await db
      .insert(documentReviewFlags)
      .values({ workspaceId, documentId, reason: 'ticket-mismatch', status: 'dismissed', score: 0.1 })
    const [newer] = await db
      .insert(documentReviewFlags)
      .values({ workspaceId, documentId, reason: 'ticket-mismatch', status: 'open', score: 0.3 })
      .returning()

    const flags = await service.listFreshnessFlags(workspaceId)

    expect(flags.map((flag) => flag.id)).toEqual([newer.id, older.id])
    expect(flags[0].documentTitle).toBe('Runbook')
  })

  it('dismisses a flag and records who dismissed it', async () => {
    const [flag] = await db
      .insert(documentReviewFlags)
      .values({ workspaceId, documentId, reason: 'ticket-mismatch', status: 'open' })
      .returning()

    const result = await service.dismissFlag(workspaceId, flag.id, userId)
    expect(result.dismissed).toBe(true)

    const [updated] = await db.select().from(documentReviewFlags).where(eq(documentReviewFlags.id, flag.id))
    expect(updated.status).toBe('dismissed')
    expect(updated.dismissedBy).toBe(userId)
    expect(updated.dismissedAt).not.toBeNull()
  })

  it('throws when dismissing a flag from the wrong workspace', async () => {
    const [flag] = await db
      .insert(documentReviewFlags)
      .values({ workspaceId, documentId, reason: 'ticket-mismatch', status: 'open' })
      .returning()

    await expect(service.dismissFlag('00000000-0000-0000-0000-000000000000', flag.id, userId)).rejects.toThrow(
      'Freshness flag not found',
    )
  })
})
