import { db, pool, users, workspaceMembers, workspaces } from '@repo/db'
import { TopicGapTickProcessor } from './topic-gap-tick.processor'

describe('TopicGapTickProcessor', () => {
  const original = process.env.SUPPORT_SURFACES_ENABLED
  const prefix = `topic-gap-tick-spec-${Date.now()}-`
  let workspaceId: string
  let tickQueue: { add: jest.Mock }
  let gapQueue: { add: jest.Mock }
  let processor: TopicGapTickProcessor

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `${prefix}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db.insert(workspaces).values({ name: prefix, ownerId: user.id }).returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
    workspaceId = workspace.id
  })

  afterAll(async () => {
    if (original === undefined) delete process.env.SUPPORT_SURFACES_ENABLED
    else process.env.SUPPORT_SURFACES_ENABLED = original
    await pool.end()
  })

  beforeEach(() => {
    tickQueue = { add: jest.fn().mockResolvedValue(undefined) }
    gapQueue = { add: jest.fn().mockResolvedValue(undefined) }
    processor = new TopicGapTickProcessor(tickQueue as never, gapQueue as never)
  })

  it('edge: queues no per-workspace job while support surfaces are off', async () => {
    delete process.env.SUPPORT_SURFACES_ENABLED

    await processor.onTick()

    expect(gapQueue.add).not.toHaveBeenCalled()
  })

  it('regression: still registers the weekly repeatable tick while off, so turning the flag on needs no Redis change', async () => {
    delete process.env.SUPPORT_SURFACES_ENABLED

    await processor.onModuleInit()

    expect(tickQueue.add).toHaveBeenCalledWith({}, expect.objectContaining({ jobId: 'topic-gap-tick' }))
  })

  it('happy: queues one job per workspace, keyed by workspace and date, when SUPPORT_SURFACES_ENABLED=true', async () => {
    process.env.SUPPORT_SURFACES_ENABLED = 'true'
    const stamp = new Date().toISOString().slice(0, 10)

    await processor.onTick()

    expect(gapQueue.add).toHaveBeenCalledWith(
      { workspaceId },
      expect.objectContaining({ jobId: `topic-gap:${workspaceId}:${stamp}` }),
    )
  })
})
