import { ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtModule } from '@nestjs/jwt'
import { ConfigModule } from '@nestjs/config'
import { createHash } from 'crypto'
import { eq } from 'drizzle-orm'
import { db, pool, users, otps, refreshTokens } from '@repo/db'
import { AuthService } from './auth.service'
import { NotificationsService } from '../notifications/notifications.service'

async function cleanupUser(email: string) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase())).limit(1)
  if (!user) return
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id))
  await db.delete(otps).where(eq(otps.userId, user.id))
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
      providers: [AuthService, NotificationsService],
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

    it('accepts the correct code with different email casing, and marks the user verified', async () => {
      const [otp] = await db.select().from(otps).where(eq(otps.userId, userId)).limit(1)
      const result = await service.verifyOtp({ email: email.toUpperCase(), code: otp.code })

      expect(result.accessToken).toBeDefined()
      expect(result.refreshToken).toBeDefined()

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
      expect(user.isVerified).toBe(true)
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
})
