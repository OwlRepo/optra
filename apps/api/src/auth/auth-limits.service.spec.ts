import { HttpException } from '@nestjs/common'
import type Redis from 'ioredis'
import {
  AuthLimitsService,
  LOGIN_FAILURE_WINDOW_SECONDS,
  MAX_LOGIN_FAILURES,
  MAX_OTP_RESENDS,
  OTP_RESEND_WINDOW_SECONDS,
} from './auth-limits.service'

function fakeRedis() {
  const chain = { set: jest.fn(), incr: jest.fn(), exec: jest.fn() }
  chain.set.mockReturnValue(chain)
  chain.incr.mockReturnValue(chain)
  const redis = { get: jest.fn(), del: jest.fn(), multi: jest.fn(() => chain) }
  return { redis, chain }
}

describe('AuthLimitsService', () => {
  it('error: refuses sign-in once the account has used its failures', async () => {
    const { redis } = fakeRedis()
    redis.get.mockResolvedValue(String(MAX_LOGIN_FAILURES))
    const service = new AuthLimitsService(redis as unknown as Redis)

    const error = await service.assertLoginAllowed('a@example.com').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(HttpException)
    expect((error as HttpException).getStatus()).toBe(429)
    expect((error as HttpException).message).toBe('Too many sign-in attempts for this account. Try again later.')
  })

  it('error: refuses a resend once the email has used its budget', async () => {
    const { redis, chain } = fakeRedis()
    chain.exec.mockResolvedValue([[null, 'OK'], [null, MAX_OTP_RESENDS + 1]])
    const service = new AuthLimitsService(redis as unknown as Redis)

    await expect(service.takeOtpResend('a@example.com')).resolves.toBe(false)
  })

  it('edge: fails open when Redis is unreachable', async () => {
    const { redis, chain } = fakeRedis()
    redis.get.mockRejectedValue(new Error('ECONNREFUSED'))
    chain.exec.mockRejectedValue(new Error('ECONNREFUSED'))
    const service = new AuthLimitsService(redis as unknown as Redis)

    await expect(service.assertLoginAllowed('a@example.com')).resolves.toBeUndefined()
    await expect(service.recordLoginFailure('a@example.com')).resolves.toBeUndefined()
    await expect(service.takeOtpResend('a@example.com')).resolves.toBe(true)
  })

  it('edge: a counter is created with its expiry in the same MULTI, keyed by a hash of the email', async () => {
    const { redis, chain } = fakeRedis()
    chain.exec.mockResolvedValue([[null, 'OK'], [null, 1]])
    const service = new AuthLimitsService(redis as unknown as Redis)

    await service.recordLoginFailure('a@example.com')

    const key = chain.set.mock.calls[0][0] as string
    expect(key).toMatch(/^auth:login-failures:[0-9a-f]{64}$/)
    expect(key).not.toContain('a@example.com')
    expect(chain.set).toHaveBeenCalledWith(key, '0', 'EX', LOGIN_FAILURE_WINDOW_SECONDS, 'NX')
    expect(chain.incr).toHaveBeenCalledWith(key)
  })

  it('happy: allows sign-in below the limit and clears the count on success', async () => {
    const { redis } = fakeRedis()
    redis.get.mockResolvedValue(String(MAX_LOGIN_FAILURES - 1))
    const service = new AuthLimitsService(redis as unknown as Redis)

    await expect(service.assertLoginAllowed('a@example.com')).resolves.toBeUndefined()
    await service.clearLoginFailures('a@example.com')
    expect(redis.del).toHaveBeenCalledWith(expect.stringMatching(/^auth:login-failures:[0-9a-f]{64}$/))
  })

  it('happy: allows resends within the budget, in their own window', async () => {
    const { redis, chain } = fakeRedis()
    chain.exec.mockResolvedValue([[null, 'OK'], [null, MAX_OTP_RESENDS]])
    const service = new AuthLimitsService(redis as unknown as Redis)

    await expect(service.takeOtpResend('a@example.com')).resolves.toBe(true)
    expect(chain.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:otp-resends:[0-9a-f]{64}$/),
      '0',
      'EX',
      OTP_RESEND_WINDOW_SECONDS,
      'NX',
    )
  })
})
