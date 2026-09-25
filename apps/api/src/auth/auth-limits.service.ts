import { createHash } from 'crypto'
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common'
import type Redis from 'ioredis'

/** Failed sign-ins one account may take, from every address together, per window. */
export const MAX_LOGIN_FAILURES = 20
export const LOGIN_FAILURE_WINDOW_SECONDS = 60 * 60
/** New verification codes one email may be sent per window. */
export const MAX_OTP_RESENDS = 3
export const OTP_RESEND_WINDOW_SECONDS = 60 * 60

/**
 * Per-ACCOUNT limits, alongside the per-address @Throttle limits on the auth
 * routes. Addresses are cheap - one IPv6 /64 holds 2^64 of them - so an
 * account needs a ceiling of its own. Counters live in Redis so a deploy does
 * not reset them, and keys carry a hash of the email, never the email.
 *
 * Fails open, as RateLimitService does: with Redis unreachable the
 * per-address limits still apply, and nobody is locked out of their own
 * account by an outage.
 */
@Injectable()
export class AuthLimitsService {
  private readonly logger = new Logger(AuthLimitsService.name)

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  /** Refuses before any password work once the account has used its failures. */
  async assertLoginAllowed(email: string): Promise<void> {
    let failures: number
    try {
      failures = Number(await this.redis.get(this.loginKey(email))) || 0
    } catch (error) {
      this.warn('read sign-in failures', error)
      return
    }
    if (failures >= MAX_LOGIN_FAILURES) {
      throw new HttpException(
        'Too many sign-in attempts for this account. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
  }

  async recordLoginFailure(email: string): Promise<void> {
    try {
      await this.bump(this.loginKey(email), LOGIN_FAILURE_WINDOW_SECONDS)
    } catch (error) {
      this.warn('record a sign-in failure', error)
    }
  }

  async clearLoginFailures(email: string): Promise<void> {
    try {
      await this.redis.del(this.loginKey(email))
    } catch (error) {
      this.warn('clear sign-in failures', error)
    }
  }

  /** True while this email may be sent another code this window; counts this one. */
  async takeOtpResend(email: string): Promise<boolean> {
    try {
      return (await this.bump(`auth:otp-resends:${this.digest(email)}`, OTP_RESEND_WINDOW_SECONDS)) <= MAX_OTP_RESENDS
    } catch (error) {
      this.warn('count a code resend', error)
      return true
    }
  }

  // SET NX with the expiry first, INCR second, in one MULTI: the key never
  // exists without a TTL, so a crash between the two cannot leave an account
  // locked for good.
  private async bump(key: string, ttlSeconds: number): Promise<number> {
    const results = await this.redis.multi().set(key, '0', 'EX', ttlSeconds, 'NX').incr(key).exec()
    const count = Number(results?.[1]?.[1])
    if (!Number.isFinite(count)) throw new Error('Redis MULTI returned no count')
    return count
  }

  private loginKey(email: string): string {
    return `auth:login-failures:${this.digest(email)}`
  }

  private digest(email: string): string {
    return createHash('sha256').update(email).digest('hex')
  }

  private warn(action: string, error: unknown): void {
    this.logger.warn(`Could not ${action}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
