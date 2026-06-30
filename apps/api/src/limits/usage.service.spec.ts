import { HttpException, Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { UsageService } from './usage.service'

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
})
