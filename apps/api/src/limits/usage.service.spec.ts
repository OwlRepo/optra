import { HttpException, Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { TokenMeter } from '@repo/ai'
import { BillingGateService } from '../billing/billing-gate.service'
import { billingStop } from '../billing/billing-stop'
import { isBudgetExceeded, UsageService } from './usage.service'

describe('UsageService', () => {
  let service: UsageService
  let redis: {
    incrby: jest.Mock
    expire: jest.Mock
    get: jest.Mock
  }
  let gate: { assertAiBudget: jest.Mock; recordLlmCost: jest.Mock }
  let flags: Record<string, string | undefined>

  beforeEach(async () => {
    redis = {
      incrby: jest.fn(),
      expire: jest.fn(),
      get: jest.fn(),
    }
    gate = {
      assertAiBudget: jest.fn().mockResolvedValue(undefined),
      recordLlmCost: jest.fn().mockResolvedValue(undefined),
    }
    flags = {}

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsageService,
        { provide: 'REDIS_CLIENT', useValue: redis as unknown as Redis },
        { provide: BillingGateService, useValue: gate },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => {
              if (key in flags) return flags[key]
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

  describe('billing metering (S4)', () => {
    const USAGE = { usage_metadata: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 } }

    async function caught(promise: Promise<unknown>): Promise<unknown> {
      try {
        await promise
      } catch (error) {
        return error
      }
      return undefined
    }

    it('error: enforcement on and state none is 402 SUBSCRIPTION_REQUIRED and the model never runs', async () => {
      flags.BILLING_ENFORCEMENT = 'on'
      gate.assertAiBudget.mockRejectedValue(billingStop('SUBSCRIPTION_REQUIRED'))
      const run = jest.fn()

      const error = await caught(service.metered('ws-1', run))

      expect(error).toBeInstanceOf(HttpException)
      expect((error as HttpException).getStatus()).toBe(402)
      expect((error as HttpException).getResponse()).toMatchObject({ code: 'SUBSCRIPTION_REQUIRED' })
      expect(gate.assertAiBudget).toHaveBeenCalledWith('ws-1')
      expect(run).not.toHaveBeenCalled()
    })

    it('error: enforcement on and over the dollar cap is 402 AI_BUDGET_EXCEEDED with a code in the body', async () => {
      flags.BILLING_ENFORCEMENT = 'on'
      gate.assertAiBudget.mockRejectedValue(billingStop('AI_BUDGET_EXCEEDED'))

      const error = await caught(service.assertWithinBudget('ws-1'))

      expect(error).toBeInstanceOf(HttpException)
      expect((error as HttpException).getResponse()).toMatchObject({ statusCode: 402, code: 'AI_BUDGET_EXCEEDED' })
      expect(isBudgetExceeded(error)).toBe(true)
    })

    it('error: enforcement on and a failing ledger read rejects and Redis is not consulted', async () => {
      flags.BILLING_ENFORCEMENT = 'on'
      gate.assertAiBudget.mockRejectedValue(new Error('db down'))
      redis.get.mockResolvedValue('0')
      const run = jest.fn()

      await expect(service.metered('ws-1', run)).rejects.toThrow('db down')

      expect(redis.get).not.toHaveBeenCalled()
      expect(run).not.toHaveBeenCalled()
    })

    it('error: ledgerOnly with enforcement on and none is 402 SUBSCRIPTION_REQUIRED', async () => {
      flags.BILLING_ENFORCEMENT = 'on'
      gate.assertAiBudget.mockRejectedValue(billingStop('SUBSCRIPTION_REQUIRED'))
      const run = jest.fn()

      const error = await caught(service.metered('ws-1', run, { ledgerOnly: true }))

      expect((error as HttpException).getResponse()).toMatchObject({ code: 'SUBSCRIPTION_REQUIRED' })
      expect(run).not.toHaveBeenCalled()
      expect(redis.get).not.toHaveBeenCalled()
    })

    it('edge: enforcement off keeps the Redis token limit: 402 without a code and the same message', async () => {
      flags.BILLING_ENFORCEMENT = 'off'
      redis.get.mockResolvedValue('100')

      const error = await caught(service.assertWithinBudget('ws-1'))

      expect(error).toBeInstanceOf(HttpException)
      expect((error as HttpException).getStatus()).toBe(402)
      expect((error as HttpException).getResponse()).toBe('Workspace monthly token budget reached')
      expect(gate.assertAiBudget).not.toHaveBeenCalled()
    })

    it('edge: enforcement off never reads the ledger for the check', async () => {
      redis.get.mockResolvedValue('0')

      await service.metered('ws-1', async () => 'ok')
      await service.assertWithinBudget('ws-1')

      expect(gate.assertAiBudget).not.toHaveBeenCalled()
    })

    it('edge: metered writes an llm_cost row in finally when the run throws after spending', async () => {
      redis.get.mockResolvedValue('0')

      await expect(
        service.metered('ws-1', async (meter) => {
          meter.record(USAGE, 'gpt-4o')
          throw new Error('model returned malformed JSON')
        }),
      ).rejects.toThrow('model returned malformed JSON')

      expect(gate.recordLlmCost).toHaveBeenCalledTimes(1)
      const [workspaceId, meter] = gate.recordLlmCost.mock.calls[0]
      expect(workspaceId).toBe('ws-1')
      expect((meter as TokenMeter).total).toBe(1500)
    })

    it('edge: metered writes nothing when the meter recorded nothing', async () => {
      redis.get.mockResolvedValue('0')

      await service.metered('ws-1', async () => 'no model call made')

      expect(gate.recordLlmCost).not.toHaveBeenCalled()
    })

    it('edge: ledgerOnly with enforcement off checks nothing, charges no Redis tokens and writes the row', async () => {
      redis.get.mockResolvedValue('100')

      const result = await service.metered(
        'ws-1',
        async (meter) => {
          meter.record(USAGE, 'gpt-4o')
          return 'refined'
        },
        { ledgerOnly: true },
      )

      expect(result).toBe('refined')
      expect(gate.assertAiBudget).not.toHaveBeenCalled()
      expect(redis.get).not.toHaveBeenCalled()
      expect(redis.incrby).not.toHaveBeenCalled()
      expect(gate.recordLlmCost).toHaveBeenCalledTimes(1)
    })

    it('regression: isBudgetExceeded is true for the coded 402 and for the legacy 402', () => {
      expect(isBudgetExceeded(billingStop('SUBSCRIPTION_REQUIRED'))).toBe(true)
      expect(isBudgetExceeded(billingStop('QUOTA_EXCEEDED', 'matchedLines'))).toBe(true)
      expect(isBudgetExceeded(new HttpException('Workspace monthly token budget reached', 402))).toBe(true)
      expect(isBudgetExceeded(new HttpException('Forbidden', 403))).toBe(false)
    })

    it('regression: metered still increments Redis by meter.total in both modes', async () => {
      redis.get.mockResolvedValue('0')

      flags.BILLING_ENFORCEMENT = 'off'
      await service.metered('ws-1', async (meter) => meter.record(USAGE, 'gpt-4o'))
      flags.BILLING_ENFORCEMENT = 'on'
      await service.metered('ws-1', async (meter) => meter.record(USAGE, 'gpt-4o'))

      expect(redis.incrby).toHaveBeenCalledTimes(2)
      expect(redis.incrby).toHaveBeenNthCalledWith(1, expect.stringMatching(/^usage:tok:ws-1:/), 1500)
      expect(redis.incrby).toHaveBeenNthCalledWith(2, expect.stringMatching(/^usage:tok:ws-1:/), 1500)
    })

    it("happy: metered passes a meter and records the call's cost, tokens and model", async () => {
      redis.get.mockResolvedValue('0')

      await service.metered('ws-1', async (meter) => {
        expect(meter).toBeInstanceOf(TokenMeter)
        meter.record(USAGE, 'gpt-4o')
      })

      const meter = gate.recordLlmCost.mock.calls[0][1] as TokenMeter
      expect(meter.costMicroUsd).toBe(7500)
      expect(meter.inputTokens).toBe(1000)
      expect(meter.outputTokens).toBe(500)
      expect(meter.dominantModel).toBe('gpt-4o')
    })

    it("happy: recordLedger writes the meter's cost through the gate", async () => {
      const meter = new TokenMeter()
      meter.record(USAGE, 'gpt-4o')

      await service.recordLedger('ws-1', meter)

      expect(gate.recordLlmCost).toHaveBeenCalledWith('ws-1', meter)
    })
  })
})
