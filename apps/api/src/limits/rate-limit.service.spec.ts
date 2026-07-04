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
    get: jest.Mock
  }

  beforeEach(async () => {
    redis = {
      incr: jest.fn(),
      expire: jest.fn(),
      get: jest.fn(),
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
              if (key === 'REFINE_DAILY_LIMIT_PER_USER') return '2'
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

  describe('checkRefineDaily', () => {
    it('allows requests under the daily limit', async () => {
      redis.incr.mockResolvedValueOnce(1)

      await expect(service.checkRefineDaily('user-1')).resolves.toBeUndefined()
      expect(redis.expire).toHaveBeenCalledTimes(1)
      expect(redis.incr).toHaveBeenCalledWith(
        expect.stringMatching(/^rl:refine:user-1:\d{8}$/),
      )
    })

    it('throws 429 when the daily limit is exceeded', async () => {
      redis.incr.mockResolvedValueOnce(3)

      await expect(service.checkRefineDaily('user-1')).rejects.toThrow(
        'Daily refine limit reached',
      )
    })

    it('does not reset the TTL on subsequent calls within the same day', async () => {
      redis.incr.mockResolvedValueOnce(2)

      await service.checkRefineDaily('user-1')

      expect(redis.expire).not.toHaveBeenCalled()
    })

    it('uses a UTC-day-bucketed key so the limit resets at midnight UTC', async () => {
      redis.incr.mockResolvedValueOnce(1)
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(
        new Date('2026-06-30T08:15:44.000Z').valueOf(),
      )

      await service.checkRefineDaily('user-22')

      nowSpy.mockRestore()
      expect(redis.incr).toHaveBeenCalledWith('rl:refine:user-22:20260630')
    })

    it('fails open on redis error', async () => {
      const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      redis.incr.mockRejectedValue(new Error('redis down'))

      await expect(service.checkRefineDaily('user-1')).resolves.toBeUndefined()
      expect(loggerSpy).toHaveBeenCalled()

      loggerSpy.mockRestore()
    })
  })

  describe('getRefineStatus', () => {
    it('returns used=0 and remaining=limit when no key exists yet', async () => {
      redis.get.mockResolvedValueOnce(null)

      await expect(service.getRefineStatus('user-1')).resolves.toEqual({
        used: 0,
        limit: 2,
        remaining: 2,
      })
      expect(redis.get).toHaveBeenCalledWith(expect.stringMatching(/^rl:refine:user-1:\d{8}$/))
    })

    it('computes remaining from the existing counter value', async () => {
      redis.get.mockResolvedValueOnce('1')

      await expect(service.getRefineStatus('user-1')).resolves.toEqual({
        used: 1,
        limit: 2,
        remaining: 1,
      })
    })

    it('clamps remaining to 0 when used exceeds the limit', async () => {
      redis.get.mockResolvedValueOnce('5')

      await expect(service.getRefineStatus('user-1')).resolves.toEqual({
        used: 5,
        limit: 2,
        remaining: 0,
      })
    })

    it('uses the same UTC-day-bucketed key as checkRefineDaily', async () => {
      redis.get.mockResolvedValueOnce('1')
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(
        new Date('2026-06-30T08:15:44.000Z').valueOf(),
      )

      await service.getRefineStatus('user-22')

      nowSpy.mockRestore()
      expect(redis.get).toHaveBeenCalledWith('rl:refine:user-22:20260630')
    })

    it('never calls incr/expire (read-only, does not consume quota)', async () => {
      redis.get.mockResolvedValueOnce('1')

      await service.getRefineStatus('user-1')

      expect(redis.incr).not.toHaveBeenCalled()
      expect(redis.expire).not.toHaveBeenCalled()
    })

    it('fails open to the full remaining budget on redis error', async () => {
      const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      redis.get.mockRejectedValue(new Error('redis down'))

      await expect(service.getRefineStatus('user-1')).resolves.toEqual({
        used: 0,
        limit: 2,
        remaining: 2,
      })
      expect(loggerSpy).toHaveBeenCalled()

      loggerSpy.mockRestore()
    })
  })
})
