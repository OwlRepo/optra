import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { InternalServerErrorException } from '@nestjs/common'
import { NotificationsService } from './notifications.service'

describe('NotificationsService', () => {
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  async function buildService(configValues: Record<string, string>) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => configValues[key] },
        },
      ],
    }).compile()

    return moduleRef.get(NotificationsService)
  }

  describe('when EMAIL_OTP_ENABLED is not "true" (dev fallback)', () => {
    it('sendOtp logs to console instead of calling Resend', async () => {
      const service = await buildService({ EMAIL_OTP_ENABLED: 'false' })

      await service.sendOtp('user@example.com', '123456')

      expect(logSpy).toHaveBeenCalledWith('[DEV OTP] user@example.com → 123456')
    })

    it('sendInvite logs to console instead of calling Resend', async () => {
      const service = await buildService({ EMAIL_OTP_ENABLED: 'false' })

      await service.sendInvite('user@example.com', 'https://example.com/invite/abc')

      expect(logSpy).toHaveBeenCalledWith('[DEV INVITE] user@example.com -> https://example.com/invite/abc')
    })

    it('sendDigestEmail logs to console instead of calling Resend', async () => {
      const service = await buildService({ EMAIL_OTP_ENABLED: 'false' })

      await service.sendDigestEmail('user@example.com', '<p>digest</p>')

      expect(logSpy).toHaveBeenCalledWith('[DEV DIGEST] user@example.com\n<p>digest</p>')
    })
  })

  describe('when EMAIL_OTP_ENABLED is "true" (Resend path)', () => {
    async function buildServiceWithStubbedResend(sendImpl: () => Promise<{ data: unknown; error: unknown }>) {
      const service = await buildService({
        EMAIL_OTP_ENABLED: 'true',
        RESEND_API_KEY: 're_test_key',
        RESEND_FROM_EMAIL: 'noreply@example.com',
      })

      // Resend is constructed internally in the constructor (not injectable), so the
      // send call is stubbed post-construction — same shape the real SDK returns.
      ;(service as unknown as { resend: { emails: { send: () => Promise<unknown> } } }).resend = {
        emails: { send: sendImpl },
      }

      return service
    }

    it('resolves without throwing when Resend reports success', async () => {
      const service = await buildServiceWithStubbedResend(async () => ({ data: { id: 'email_123' }, error: null }))

      await expect(service.sendOtp('user@example.com', '123456')).resolves.toBeUndefined()
    })

    it('throws when Resend resolves with an error object instead of rejecting', async () => {
      // This is the real SDK contract (resend@6.16.0 Resend.fetchRequest): it NEVER
      // rejects on API failures (bad key, unverified domain, rate limit) — it always
      // resolves `{ data: null, error: {...} }`. Before the fix, sendOtp() discarded
      // this return value entirely, so a failed send looked identical to a successful
      // one to every caller: no exception, no log line, register() still returned 201.
      const service = await buildServiceWithStubbedResend(async () => ({
        data: null,
        error: { name: 'validation_error', message: 'Domain not verified', statusCode: 403 },
      }))

      await expect(service.sendOtp('user@example.com', '123456')).rejects.toThrow(InternalServerErrorException)
    })

    it('sendInvite also throws when Resend resolves with an error object', async () => {
      const service = await buildServiceWithStubbedResend(async () => ({
        data: null,
        error: { name: 'validation_error', message: 'Domain not verified', statusCode: 403 },
      }))

      await expect(
        service.sendInvite('user@example.com', 'https://example.com/invite/abc'),
      ).rejects.toThrow(InternalServerErrorException)
    })

    it('sendDigestEmail also throws when Resend resolves with an error object', async () => {
      const service = await buildServiceWithStubbedResend(async () => ({
        data: null,
        error: { name: 'validation_error', message: 'Domain not verified', statusCode: 403 },
      }))

      await expect(service.sendDigestEmail('user@example.com', '<p>digest</p>')).rejects.toThrow(
        InternalServerErrorException,
      )
    })
  })
})
