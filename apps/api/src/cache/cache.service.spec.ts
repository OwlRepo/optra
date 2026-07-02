import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import type Redis from 'ioredis'
import { db } from '@repo/db'
import { CacheService } from './cache.service'

jest.mock('@repo/db', () => {
  const actual = jest.requireActual('@repo/db')
  return {
    ...actual,
    db: {
      execute: jest.fn(),
      insert: jest.fn(),
    },
  }
})

describe('CacheService', () => {
  let service: CacheService
  let redis: {
    get: jest.Mock
    set: jest.Mock
    setnx: jest.Mock
    incr: jest.Mock
  }
  let config: {
    get: jest.Mock
  }

  beforeEach(async () => {
    redis = {
      get: jest.fn(),
      set: jest.fn(),
      setnx: jest.fn(),
      incr: jest.fn(),
    }
    config = {
      get: jest.fn((key: string, fallback?: string | number) => fallback),
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: 'REDIS_CLIENT', useValue: redis as unknown as Redis },
        { provide: ConfigService, useValue: config },
      ],
    }).compile()

    service = moduleRef.get(CacheService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('round-trips exact cache per workspace + version and isolates other workspaces', async () => {
    redis.get.mockImplementation(async (key: string) => {
      if (key === 'chat:ver:ws-1') return '3'
      if (key === 'chat:ver:ws-2') return '3'
      if (key.includes('chat:ans:ws-1:3:')) {
        return JSON.stringify({
          answer: 'cached answer',
          sources: [{ documentId: 'doc-1', title: 'Doc 1', sourceUrl: null, score: 0.9, snippet: 's' }],
        })
      }
      return null
    })

    const hit = await service.getExact('ws-1', '  Reset   Password ')
    const miss = await service.getExact('ws-2', 'reset password')

    expect(hit).toEqual({
      answer: 'cached answer',
      sources: [{ documentId: 'doc-1', title: 'Doc 1', sourceUrl: null, score: 0.9, snippet: 's' }],
    })
    expect(miss).toBeNull()

    await service.setExact('ws-1', 'reset password', 'fresh answer', [])
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^chat:ans:ws-1:3:[a-f0-9]{64}$/),
      JSON.stringify({ answer: 'fresh answer', sources: [] }),
      'EX',
      3600,
    )
  })

  it('bumpVersion makes old exact entries unreachable', async () => {
    redis.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(JSON.stringify({ answer: 'stale', sources: [] }))
      .mockResolvedValueOnce('2')
      .mockResolvedValueOnce(null)
    redis.incr.mockResolvedValue(2)
    redis.setnx.mockResolvedValue(1)

    const before = await service.getExact('ws-version', 'hello')
    await service.bumpVersion('ws-version')
    const after = await service.getExact('ws-version', 'hello')

    expect(before).toEqual({ answer: 'stale', sources: [] })
    expect(redis.setnx).toHaveBeenCalledWith('chat:ver:ws-version', '1')
    expect(redis.incr).toHaveBeenCalledWith('chat:ver:ws-version')
    expect(after).toBeNull()
  })

  it('semantic hit requires score threshold and workspace scope', async () => {
    config.get.mockImplementation((key: string, fallback?: string | number) => {
      if (key === 'SEMANTIC_CACHE_THRESHOLD') return '0.95'
      if (key === 'SEMANTIC_CACHE_TTL_HOURS') return '48'
      return fallback
    })
    redis.get.mockResolvedValue('5')
    ;(db.execute as jest.Mock)
      .mockResolvedValueOnce({
        rows: [
          {
            answer: 'semantic yes',
            sources: [{ documentId: 'doc-2', title: 'Doc 2', sourceUrl: null, score: 0.98, snippet: 'x' }],
            score: 0.97,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            answer: 'too low',
            sources: [],
            score: 0.7,
          },
        ],
      })

    const hit = await service.getSemantic('ws-semantic', [0.1, 0.2, 0.3])
    const miss = await service.getSemantic('ws-semantic', [0.3, 0.2, 0.1])

    expect(hit).toEqual({
      answer: 'semantic yes',
      sources: [{ documentId: 'doc-2', title: 'Doc 2', sourceUrl: null, score: 0.98, snippet: 'x' }],
    })
    expect(miss).toBeNull()
    expect(db.execute).toHaveBeenCalledTimes(2)
    expect(db.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        queryChunks: expect.arrayContaining([
          expect.objectContaining({ value: [expect.stringContaining('where workspace_id = ')] }),
          expect.objectContaining({ value: [expect.stringContaining('and version = ')] }),
          expect.objectContaining({
            value: [expect.stringContaining('and created_at > now() - make_interval(hours => ')],
          }),
        ]),
      }),
    )
    expect(config.get).toHaveBeenCalledWith('SEMANTIC_CACHE_TTL_HOURS', '24')
  })

  it('saveSemantic inserts then cleans up expired rows for workspace', async () => {
    const values = jest.fn().mockResolvedValue(undefined)
    ;(db.insert as jest.Mock).mockReturnValue({ values })
    ;(db.execute as jest.Mock).mockResolvedValue({ rows: [] })

    await service.saveSemantic('ws-semantic', 2, 'question', [0.1, 0.2], 'answer', [])

    expect(db.insert).toHaveBeenCalled()
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-semantic',
        version: 2,
        question: 'question',
        answer: 'answer',
      }),
    )
    expect(db.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        queryChunks: expect.arrayContaining([
          expect.objectContaining({ value: [expect.stringContaining('delete from chat_cache')] }),
          expect.objectContaining({ value: [expect.stringContaining('created_at <= now() - make_interval(hours => ')] }),
        ]),
      }),
    )
  })

  it('saveSemantic swallows cleanup failure after successful insert', async () => {
    const values = jest.fn().mockResolvedValue(undefined)
    ;(db.insert as jest.Mock).mockReturnValue({ values })
    ;(db.execute as jest.Mock).mockRejectedValueOnce(new Error('cleanup failed'))

    await expect(
      service.saveSemantic('ws-semantic', 2, 'question', [0.1, 0.2], 'answer', []),
    ).resolves.toBeUndefined()

    expect(values).toHaveBeenCalled()
    expect(db.execute).toHaveBeenCalledTimes(1)
  })
})
