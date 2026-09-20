import { HttpException, Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { isBudgetExceeded, UsageService } from './usage.service'

describe('UsageService', () => {
  let service: UsageService
  let redis: {
    incrby: jest.Mock
    expire: jest.Mock
    get: jest.Mock
  }

  beforeEach(async () => {
    redis = {
      incrby: jest.fn(),
      expire: jest.fn(),
      get: jest.fn(),
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsageService,
        { provide: 'REDIS_CLIENT', useValue: redis as unknown as Redis },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => {
              if (key === 'MAX_TOKENS_PER_WORKSPACE_MONTH') return '100'
              return fallback
            }),
          },
        },
      ],
    }).compile()

    service = moduleRef.get(UsageService)
  })

  it('addUsage increments monthly workspace key', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-06-30T08:15:44.000Z').valueOf(),
    )
    redis.incrby.mockResolvedValue(20)

    await service.addUsage('ws-1', 20)

    nowSpy.mockRestore()
    expect(redis.incrby).toHaveBeenCalledWith('usage:tok:ws-1:202606', 20)
    expect(redis.expire).toHaveBeenCalledWith('usage:tok:ws-1:202606', 60 * 60 * 24 * 40)
  })

  it('assertWithinBudget throws 402 once workspace monthly cap reached', async () => {
    redis.get.mockResolvedValue('100')

    await expect(service.assertWithinBudget('ws-1')).rejects.toThrow(
      'Workspace monthly token budget reached',
    )
  })

  it('scopes reads by workspace and month', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-06-30T08:15:44.000Z').valueOf(),
    )
    redis.get.mockResolvedValue('50')

    await expect(service.assertWithinBudget('ws-9')).resolves.toBeUndefined()

    nowSpy.mockRestore()
    expect(redis.get).toHaveBeenCalledWith('usage:tok:ws-9:202606')
  })

  it('fails open on redis error', async () => {
    const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    redis.get.mockRejectedValue(new Error('redis down'))
    redis.incrby.mockRejectedValue(new Error('redis down'))

    await expect(service.assertWithinBudget('ws-1')).resolves.toBeUndefined()
    await expect(service.addUsage('ws-1', 10)).resolves.toBeUndefined()
    expect(loggerSpy).toHaveBeenCalled()

    loggerSpy.mockRestore()
  })

  it('metered checks the budget before running the call', async () => {
    redis.get.mockResolvedValue('100')
    const run = jest.fn()

    await expect(service.metered('ws-1', run)).rejects.toThrow('Workspace monthly token budget reached')
    expect(run).not.toHaveBeenCalled()
  })

  it('metered charges the provider-reported tokens once the call finishes', async () => {
    redis.get.mockResolvedValue('0')

    const result = await service.metered('ws-1', async (meter) => {
      meter.record({ usage_metadata: { total_tokens: 42 } })
      return 'ok'
    })

    expect(result).toBe('ok')
    expect(redis.incrby).toHaveBeenCalledWith(expect.stringMatching(/^usage:tok:ws-1:/), 42)
  })

  it('metered still charges tokens spent before the call threw', async () => {
    redis.get.mockResolvedValue('0')

    await expect(
      service.metered('ws-1', async (meter) => {
        meter.record({ usage_metadata: { total_tokens: 17 } })
        throw new Error('model returned malformed JSON')
      }),
    ).rejects.toThrow('model returned malformed JSON')
    expect(redis.incrby).toHaveBeenCalledWith(expect.stringMatching(/^usage:tok:ws-1:/), 17)
  })

  it('metered records nothing when the call reported no tokens', async () => {
    redis.get.mockResolvedValue('0')

    await service.metered('ws-1', async () => 'no model call made')

    expect(redis.incrby).not.toHaveBeenCalled()
  })

  it('isBudgetExceeded recognizes only the budget 402', () => {
    expect(isBudgetExceeded(new HttpException('Workspace monthly token budget reached', 402))).toBe(true)
    expect(isBudgetExceeded(new HttpException('Bad Request', 400))).toBe(false)
    expect(isBudgetExceeded(new Error('boom'))).toBe(false)
  })
})
