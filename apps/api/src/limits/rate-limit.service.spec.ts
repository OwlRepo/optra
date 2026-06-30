import { HttpException, Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { RateLimitService } from './rate-limit.service'

describe('RateLimitService', () => {
  let service: RateLimitService
  let redis: {
    incr: jest.Mock
    expire: jest.Mock
  }

  beforeEach(async () => {
    redis = {
      incr: jest.fn(),
      expire: jest.fn(),
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        RateLimitService,
        { provide: 'REDIS_CLIENT', useValue: redis as unknown as Redis },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => {
              if (key === 'CHAT_RATE_LIMIT_PER_MIN_PER_USER') return '2'
              if (key === 'CHAT_RATE_LIMIT_PER_MIN_PER_WORKSPACE') return '3'
              return fallback
            }),
          },
        },
      ],
    }).compile()

    service = moduleRef.get(RateLimitService)
  })

  it('allows requests under both limits', async () => {
    redis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(1)

    await expect(service.check('user-1', 'ws-1')).resolves.toBeUndefined()
    expect(redis.expire).toHaveBeenCalledTimes(2)
    expect(redis.incr).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^rl:user:user-1:\d+$/),
    )
    expect(redis.incr).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^rl:ws:ws-1:\d+$/),
    )
  })

  it('throws 429 when per-user limit exceeded', async () => {
    redis.incr.mockResolvedValueOnce(3).mockResolvedValueOnce(1)

    await expect(service.check('user-1', 'ws-1')).rejects.toThrow('Rate limit exceeded')
  })

  it('throws 429 when per-workspace limit exceeded', async () => {
    redis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(4)

    await expect(service.check('user-1', 'ws-1')).rejects.toThrow('Rate limit exceeded')
  })

  it('uses minute-bucketed user and workspace keys', async () => {
    redis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(1)

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-06-30T08:15:44.000Z').valueOf(),
    )

    await service.check('user-22', 'ws-44')

    nowSpy.mockRestore()
    expect(redis.incr).toHaveBeenNthCalledWith(1, 'rl:user:user-22:29713455')
    expect(redis.incr).toHaveBeenNthCalledWith(2, 'rl:ws:ws-44:29713455')
  })

  it('fails open on redis error', async () => {
    const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    redis.incr.mockRejectedValue(new Error('redis down'))

    await expect(service.check('user-1', 'ws-1')).resolves.toBeUndefined()
    expect(loggerSpy).toHaveBeenCalled()

    loggerSpy.mockRestore()
  })
})
