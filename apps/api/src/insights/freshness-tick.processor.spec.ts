import { db, pool, users, workspaceMembers, workspaces } from '@repo/db'
import { FreshnessTickProcessor } from './freshness-tick.processor'

describe('FreshnessTickProcessor', () => {
  const original = process.env.SUPPORT_SURFACES_ENABLED
  const prefix = `freshness-tick-spec-${Date.now()}-`
  let workspaceId: string
  let tickQueue: { add: jest.Mock }
  let checkQueue: { add: jest.Mock }
  let processor: FreshnessTickProcessor

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
    checkQueue = { add: jest.fn().mockResolvedValue(undefined) }
    processor = new FreshnessTickProcessor(tickQueue as never, checkQueue as never)
  })

  it('edge: queues no per-workspace job while support surfaces are off', async () => {
    delete process.env.SUPPORT_SURFACES_ENABLED

    await processor.onTick()

    expect(checkQueue.add).not.toHaveBeenCalled()
  })

  it('regression: still registers the weekly repeatable tick while off, so turning the flag on needs no Redis change', async () => {
    delete process.env.SUPPORT_SURFACES_ENABLED

    await processor.onModuleInit()

    expect(tickQueue.add).toHaveBeenCalledWith({}, expect.objectContaining({ jobId: 'freshness-tick' }))
  })

  it('happy: queues one job per workspace, keyed by workspace and date, when SUPPORT_SURFACES_ENABLED=true', async () => {
    process.env.SUPPORT_SURFACES_ENABLED = 'true'
    const stamp = new Date().toISOString().slice(0, 10)

    await processor.onTick()

    expect(checkQueue.add).toHaveBeenCalledWith(
      { workspaceId },
      expect.objectContaining({ jobId: `freshness-check:${workspaceId}:${stamp}` }),
    )
  })
})
