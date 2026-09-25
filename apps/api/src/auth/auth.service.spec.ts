import {
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtModule } from '@nestjs/jwt'
import { ConfigModule } from '@nestjs/config'
import { createHash } from 'crypto'
import { and, desc, eq } from 'drizzle-orm'
import { db, otps, pool, refreshTokens, users, workspaceMembers, workspaces } from '@repo/db'
import { AuthService } from './auth.service'
import { AuthLimitsService } from './auth-limits.service'
import { NotificationsService } from '../notifications/notifications.service'

// Per-account counters are Redis state with their own spec
// (auth-limits.service.spec.ts); here only the calls AuthService makes matter.
const limits = {
  takeLoginAttempt: jest.fn().mockResolvedValue(undefined),
  clearLoginFailures: jest.fn().mockResolvedValue(undefined),
  takeOtpResend: jest.fn().mockResolvedValue(true),
}
const notifications = { sendOtp: jest.fn().mockResolvedValue(undefined) }

async function cleanupUser(email: string) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase())).limit(1)
  if (!user) return
  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, user.id))
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id))
  await db.delete(otps).where(eq(otps.userId, user.id))
  await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))
  for (const membership of memberships) {
    await db.delete(workspaces).where(and(eq(workspaces.id, membership.workspaceId), eq(workspaces.ownerId, user.id)))
  }
  await db.delete(users).where(eq(users.id, user.id))
}

describe('AuthService', () => {
  let service: AuthService

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        JwtModule.register({ secret: 'test-secret-only', signOptions: { expiresIn: '15m' } }),
      ],
      providers: [
        AuthService,
        { provide: AuthLimitsService, useValue: limits },
        // Stubbed, not the real NotificationsService: these tests exercise auth
        // business logic (DB state, tokens, guards), not email delivery — that has
        // its own coverage in notifications.service.spec.ts and the dedicated
        // "email send failure" block below. Using the real service here would make
        // every test in this file depend on a live Resend account/domain.
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile()

    service = moduleRef.get(AuthService)
  })

  afterAll(async () => {
    await pool.end()
  })

  describe('register', () => {
    const email = `svc-register-${Date.now()}@example.com`

    afterAll(() => cleanupUser(email))

    it('creates an unverified user with a hashed password and a 6-digit OTP', async () => {
      const result = await service.register({ email, password: 'password123' })
      expect(result.message).toMatch(/check your email/i)

      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
      expect(user).toBeDefined()
      expect(user.passwordHash).not.toBe('password123')
      expect(user.isVerified).toBe(false)

      const [otp] = await db.select().from(otps).where(eq(otps.userId, user.id)).limit(1)
      expect(otp.code).toMatch(/^\d{6}$/)
    })

    it('rejects a duplicate email (exact case)', async () => {
      await expect(service.register({ email, password: 'password123' })).rejects.toThrow(ConflictException)
    })

    it('rejects a duplicate email that only differs by case', async () => {
      await expect(
        service.register({ email: email.toUpperCase(), password: 'password123' }),
      ).rejects.toThrow(ConflictException)
    })
  })

  describe('register — email send failure', () => {
    // Regression test for the silent-swallow bug: NotificationsService.sendOtp()
    // used to discard Resend's `{ data, error }` return value entirely, so a failed
    // send looked identical to success (register() returned 201 with no OTP ever sent,
    // and no error anywhere). It now throws on failure, and that must propagate here.
    const email = `svc-register-email-fail-${Date.now()}@example.com`
    let failingService: AuthService

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          JwtModule.register({ secret: 'test-secret-only', signOptions: { expiresIn: '15m' } }),
        ],
        providers: [
          AuthService,
          { provide: AuthLimitsService, useValue: limits },
          {
            provide: NotificationsService,
            useValue: {
              sendOtp: jest.fn().mockRejectedValue(new InternalServerErrorException('Failed to send verification email')),
            },
          },
        ],
      }).compile()

      failingService = moduleRef.get(AuthService)
    })

    afterAll(() => cleanupUser(email))

    it('propagates the send failure instead of returning a false-positive success', async () => {
      await expect(failingService.register({ email, password: 'password123' })).rejects.toThrow(
        InternalServerErrorException,
      )
    })
  })

  describe('verifyOtp', () => {
    const email = `svc-verify-${Date.now()}@example.com`
    let userId: string

    beforeAll(async () => {
      await service.register({ email, password: 'password123' })
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
      userId = user.id
    })

    afterAll(() => cleanupUser(email))

    it('rejects a wrong code', async () => {
      await expect(service.verifyOtp({ email, code: '000000' })).rejects.toThrow(UnauthorizedException)
    })

    it('rejects an expired code', async () => {
      await db.update(otps).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(otps.userId, userId))
      const [otp] = await db.select().from(otps).where(eq(otps.userId, userId)).limit(1)

      await expect(service.verifyOtp({ email, code: otp.code })).rejects.toThrow(UnauthorizedException)

      await db
        .update(otps)
        .set({ expiresAt: new Date(Date.now() + 10 * 60 * 1000) })
        .where(eq(otps.userId, userId))
    })

    it('rejects a non-existent email', async () => {
      await expect(
        service.verifyOtp({ email: 'svc-verify-nobody@example.com', code: '123456' }),
      ).rejects.toThrow(UnauthorizedException)
    })

    it('accepts the correct code with different email casing, marks the user verified, and auto-creates an owner workspace', async () => {
      const [otp] = await db.select().from(otps).where(eq(otps.userId, userId)).limit(1)
      const result = await service.verifyOtp({ email: email.toUpperCase(), code: otp.code })

      expect(result.accessToken).toBeDefined()
      expect(result.refreshToken).toBeDefined()

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
      expect(user.isVerified).toBe(true)

      const ownedWorkspaces = await db.select().from(workspaces).where(eq(workspaces.ownerId, userId))
      expect(ownedWorkspaces).toHaveLength(1)
      expect(ownedWorkspaces[0].name).toBe(`${email}'s workspace`)

      const [membership] = await db
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, ownedWorkspaces[0].id),
            eq(workspaceMembers.userId, userId),
          ),
        )
        .limit(1)
      expect(membership.role).toBe('owner')
    })

    it('rejects reusing an already-used code', async () => {
      const [otp] = await db.select().from(otps).where(eq(otps.userId, userId)).limit(1)
      await expect(service.verifyOtp({ email, code: otp.code })).rejects.toThrow(UnauthorizedException)
    })
  })

  describe('login', () => {
    const email = `svc-login-${Date.now()}@example.com`
    const password = 'password123'

    beforeAll(async () => {
      await service.register({ email, password })
    })

    afterAll(() => cleanupUser(email))

    it('rejects login before the account is verified', async () => {
      await expect(service.login({ email, password })).rejects.toThrow(ForbiddenException)
    })

    it('rejects a non-existent email', async () => {
      await expect(
        service.login({ email: 'svc-login-nobody@example.com', password }),
      ).rejects.toThrow(UnauthorizedException)
    })

    it('rejects the wrong password', async () => {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
      const [otp] = await db.select().from(otps).where(eq(otps.userId, user.id)).limit(1)
      await service.verifyOtp({ email, code: otp.code })

      await expect(service.login({ email, password: 'totally-wrong' })).rejects.toThrow(UnauthorizedException)
    })

    it('logs in successfully, including with different email casing', async () => {
      const result = await service.login({ email: email.toUpperCase(), password })
      expect(result.accessToken).toBeDefined()
      expect(result.refreshToken).toBeDefined()
    })

    it('error: a locked account is refused before the password is checked', async () => {
      limits.clearLoginFailures.mockClear()
      limits.takeLoginAttempt.mockRejectedValueOnce(new HttpException('locked', 429))

      await expect(service.login({ email, password })).rejects.toMatchObject({ status: 429 })
      expect(limits.clearLoginFailures).not.toHaveBeenCalled()
    })

    it('error: a wrong password is counted against the account and not cleared', async () => {
      limits.takeLoginAttempt.mockClear()
      limits.clearLoginFailures.mockClear()
      await expect(service.login({ email, password: 'totally-wrong' })).rejects.toThrow(UnauthorizedException)
      expect(limits.takeLoginAttempt).toHaveBeenCalledWith(email)
      expect(limits.clearLoginFailures).not.toHaveBeenCalled()
    })

    it('edge: an email with no account is counted the same way', async () => {
      limits.takeLoginAttempt.mockClear()
      await expect(
        service.login({ email: 'svc-login-ghost@example.com', password }),
      ).rejects.toThrow(UnauthorizedException)
      expect(limits.takeLoginAttempt).toHaveBeenCalledWith('svc-login-ghost@example.com')
    })

    it('happy: a correct password clears the account count', async () => {
      limits.clearLoginFailures.mockClear()
      await service.login({ email, password })
      expect(limits.clearLoginFailures).toHaveBeenCalledWith(email)
    })
  })

  describe('verifyOtp attempt limit', () => {
    const email = `svc-verify-burn-${Date.now()}@example.com`

    beforeAll(async () => {
      await service.register({ email, password: 'password123' })
    })

    afterAll(() => cleanupUser(email))

    it('error: the fifth wrong code burns the code for good', async () => {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
      const [otp] = await db.select().from(otps).where(eq(otps.userId, user.id)).limit(1)
      const wrong = otp.code === '111111' ? '222222' : '111111'

      for (let i = 0; i < 4; i++) {
        await expect(service.verifyOtp({ email, code: wrong })).rejects.toThrow('Invalid or expired code')
      }
      await expect(service.verifyOtp({ email, code: wrong })).rejects.toThrow('Too many wrong codes. Request a new code.')
      await expect(service.verifyOtp({ email, code: otp.code })).rejects.toThrow('Invalid or expired code')

      const [burned] = await db.select().from(otps).where(eq(otps.id, otp.id)).limit(1)
      expect(burned.failedAttempts).toBe(5)
      expect(burned.usedAt).toBeNull()
    })

    it('error: an unknown email gets the same answer as a wrong code', async () => {
      await expect(
        service.verifyOtp({ email: 'svc-verify-ghost@example.com', code: '123456' }),
      ).rejects.toThrow('Invalid or expired code')
    })

    it('error: ten wrong codes sent at once use up the five attempts and no more', async () => {
      const burstEmail = `svc-verify-burst-${Date.now()}@example.com`
      await service.register({ email: burstEmail, password: 'password123' })
      try {
        const [user] = await db.select().from(users).where(eq(users.email, burstEmail)).limit(1)
        const [otp] = await db.select().from(otps).where(eq(otps.userId, user.id)).limit(1)
        const wrong = otp.code === '111111' ? '222222' : '111111'

        const results = await Promise.allSettled(
          Array.from({ length: 10 }, () => service.verifyOtp({ email: burstEmail, code: wrong })),
        )

        expect(results.every((result) => result.status === 'rejected')).toBe(true)
        const [after] = await db.select().from(otps).where(eq(otps.id, otp.id)).limit(1)
        expect(after.failedAttempts).toBe(5)
      } finally {
        await cleanupUser(burstEmail)
      }
    })
  })

  describe('verifyOtp on a verified account', () => {
    const email = `svc-verify-twice-${Date.now()}@example.com`

    afterAll(() => cleanupUser(email))

    it('regression: a verified account is refused, and no second workspace is created', async () => {
      await service.register({ email, password: 'password123' })
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
      const [otp] = await db.select().from(otps).where(eq(otps.userId, user.id)).limit(1)
      await service.verifyOtp({ email, code: otp.code })
      await db.insert(otps).values({ userId: user.id, code: '123456', expiresAt: new Date(Date.now() + 600_000) })

      await expect(service.verifyOtp({ email, code: '123456' })).rejects.toThrow('Invalid or expired code')

      const owned = await db.select().from(workspaces).where(eq(workspaces.ownerId, user.id))
      expect(owned).toHaveLength(1)
    })
  })

  describe('resendOtp', () => {
    const email = `svc-resend-${Date.now()}@example.com`
    const answer = 'If that account is waiting for verification, a new code is on its way.'

    beforeAll(async () => {
      await service.register({ email, password: 'password123' })
    })

    afterAll(() => cleanupUser(email))

    it('edge: an unknown email gets the same answer and nothing is sent', async () => {
      notifications.sendOtp.mockClear()
      await expect(service.resendOtp({ email: 'svc-resend-ghost@example.com' })).resolves.toEqual({ message: answer })
      expect(notifications.sendOtp).not.toHaveBeenCalled()
    })

    it('edge: over the resend budget gets the same answer and no new code', async () => {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
      const before = await db.select().from(otps).where(eq(otps.userId, user.id))
      limits.takeOtpResend.mockResolvedValueOnce(false)

      await expect(service.resendOtp({ email })).resolves.toEqual({ message: answer })

      expect(await db.select().from(otps).where(eq(otps.userId, user.id))).toHaveLength(before.length)
    })

    it('error: a failed email send keeps the old code live and the new one dead', async () => {
      const failEmail = `svc-resend-fail-${Date.now()}@example.com`
      await service.register({ email: failEmail, password: 'password123' })
      try {
        const [user] = await db.select().from(users).where(eq(users.email, failEmail)).limit(1)
        notifications.sendOtp.mockRejectedValueOnce(new InternalServerErrorException('Failed to send verification email'))

        await expect(service.resendOtp({ email: failEmail })).rejects.toThrow(InternalServerErrorException)

        const codes = await db.select().from(otps).where(eq(otps.userId, user.id)).orderBy(desc(otps.createdAt))
        expect(codes).toHaveLength(2)
        expect(codes[0].expiresAt.getTime()).toBeLessThanOrEqual(Date.now())
        expect(codes[1].expiresAt.getTime()).toBeGreaterThan(Date.now())
      } finally {
        await cleanupUser(failEmail)
      }
    })

    it('happy: expires the old code, stores a new one and sends it', async () => {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
      notifications.sendOtp.mockClear()

      await expect(service.resendOtp({ email: email.toUpperCase() })).resolves.toEqual({ message: answer })

      const codes = await db.select().from(otps).where(eq(otps.userId, user.id)).orderBy(desc(otps.createdAt))
      expect(codes).toHaveLength(2)
      expect(codes[1].expiresAt.getTime()).toBeLessThanOrEqual(Date.now())
      expect(codes[0].code).toMatch(/^\d{6}$/)
      expect(notifications.sendOtp).toHaveBeenCalledWith(email, codes[0].code)
    })
  })

  describe('refresh and logout', () => {
    const password = 'password123'

    async function registerAndVerify(suffix: string) {
      const email = `svc-refresh-${suffix}-${Date.now()}@example.com`
      await service.register({ email, password })
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
      const [otp] = await db.select().from(otps).where(eq(otps.userId, user.id)).limit(1)
      const result = await service.verifyOtp({ email, code: otp.code })
      return { email, userId: user.id, refreshToken: result.refreshToken }
    }

    it('rejects a garbage/non-existent refresh token', async () => {
      await expect(service.refresh('not-a-real-token')).rejects.toThrow(UnauthorizedException)
    })

    it('rotates: issues a new access token AND a new, different refresh token', async () => {
      const { email, refreshToken } = await registerAndVerify('rotate')
      try {
        const result = await service.refresh(refreshToken)
        expect(result.accessToken).toBeDefined()
        expect(result.refreshToken).toBeDefined()
        expect(result.refreshToken).not.toBe(refreshToken)
      } finally {
        await cleanupUser(email)
      }
    })

    it('rejects reusing the old refresh token after it has been rotated away', async () => {
      const { email, refreshToken } = await registerAndVerify('reuse')
      try {
        await service.refresh(refreshToken)
        await expect(service.refresh(refreshToken)).rejects.toThrow(UnauthorizedException)
      } finally {
        await cleanupUser(email)
      }
    })

    it('reusing an already-rotated token revokes ALL of that user\'s active refresh tokens (theft response)', async () => {
      const { email, refreshToken } = await registerAndVerify('theft')
      try {
        const { refreshToken: rotated } = await service.refresh(refreshToken)

        await expect(service.refresh(refreshToken)).rejects.toThrow(UnauthorizedException)

        // the newer, otherwise-legitimate token must also be dead now — reuse nukes the whole session
        await expect(service.refresh(rotated)).rejects.toThrow(UnauthorizedException)
      } finally {
        await cleanupUser(email)
      }
    })

    it('rejects an expired refresh token', async () => {
      const { email, refreshToken } = await registerAndVerify('expired')
      try {
        const tokenHash = createHash('sha256').update(refreshToken).digest('hex')
        await db
          .update(refreshTokens)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(refreshTokens.tokenHash, tokenHash))

        await expect(service.refresh(refreshToken)).rejects.toThrow(UnauthorizedException)
      } finally {
        await cleanupUser(email)
      }
    })

    it('logout revokes the token, and a subsequent refresh is then rejected', async () => {
      const { email, refreshToken } = await registerAndVerify('logout')
      try {
        await service.logout(refreshToken)
        await expect(service.refresh(refreshToken)).rejects.toThrow(UnauthorizedException)
      } finally {
        await cleanupUser(email)
      }
    })

    it('logout on an already-revoked or unknown token does not throw', async () => {
      const { email, refreshToken } = await registerAndVerify('double-logout')
      try {
        await service.logout(refreshToken)
        await expect(service.logout(refreshToken)).resolves.toEqual({ message: 'Logged out' })
        await expect(service.logout('never-existed')).resolves.toEqual({ message: 'Logged out' })
      } finally {
        await cleanupUser(email)
      }
    })
  })

  describe('changePassword', () => {
    const password = 'password123'

    async function registerAndVerify(suffix: string) {
      const email = `svc-changepw-${suffix}-${Date.now()}@example.com`
      await service.register({ email, password })
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
      const [otp] = await db.select().from(otps).where(eq(otps.userId, user.id)).limit(1)
      await service.verifyOtp({ email, code: otp.code })
      return { email, userId: user.id }
    }

    it('rejects the wrong current password', async () => {
      const { email, userId } = await registerAndVerify('wrong')
      try {
        await expect(
          service.changePassword(userId, 'totally-wrong', 'newpassword123'),
        ).rejects.toThrow(UnauthorizedException)
      } finally {
        await cleanupUser(email)
      }
    })

    it('accepts the correct current password, re-hashes, and the new password then works for login', async () => {
      const { email, userId } = await registerAndVerify('accept')
      try {
        await service.changePassword(userId, password, 'newpassword123')

        await expect(service.login({ email, password: 'newpassword123' })).resolves.toBeDefined()
      } finally {
        await cleanupUser(email)
      }
    })

    it('the old password no longer works after a successful change', async () => {
      const { email, userId } = await registerAndVerify('old-dead')
      try {
        await service.changePassword(userId, password, 'newpassword123')

        await expect(service.login({ email, password })).rejects.toThrow(UnauthorizedException)
      } finally {
        await cleanupUser(email)
      }
    })

    it('revokes ALL of the caller\'s previously-issued active refresh tokens', async () => {
      const { email, userId } = await registerAndVerify('revoke')
      try {
        const first = await service.login({ email, password })
        const second = await service.login({ email, password })

        await service.changePassword(userId, password, 'newpassword123')

        await expect(service.refresh(first.refreshToken)).rejects.toThrow(UnauthorizedException)
        await expect(service.refresh(second.refreshToken)).rejects.toThrow(UnauthorizedException)
      } finally {
        await cleanupUser(email)
      }
    })

    it('does not throw when the user has zero active refresh tokens', async () => {
      const { email, userId } = await registerAndVerify('zero-tokens')
      try {
        await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId))

        await expect(
          service.changePassword(userId, password, 'newpassword123'),
        ).resolves.toEqual({ message: expect.any(String) })
      } finally {
        await cleanupUser(email)
      }
    })
  })
})
