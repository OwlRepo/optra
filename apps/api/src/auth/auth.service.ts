import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { eq, and, gt, inArray, isNull, lt, ne, desc, sql } from 'drizzle-orm'
import * as bcrypt from 'bcrypt'
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto'
import { db, users, otps, refreshTokens, workspaceMembers, workspaces } from '@repo/db'
import type { RegisterDto } from './dto/register.dto'
import type { VerifyOtpDto } from './dto/verify-otp.dto'
import type { LoginDto } from './dto/login.dto'
import type { ResendOtpDto } from './dto/resend-otp.dto'
import { NotificationsService } from '../notifications/notifications.service'
import { AuthLimitsService } from './auth-limits.service'

const BCRYPT_ROUNDS = 12
const OTP_EXPIRY_MINUTES = 10
const RT_EXPIRY_DAYS = 7
/** Wrong guesses one verification code survives. */
const MAX_OTP_ATTEMPTS = 5
const INVALID_CODE = 'Invalid or expired code'
const RESEND_ANSWER = 'If that account is waiting for verification, a new code is on its way.'
// Compared against when the email has no account, so an unknown email costs
// the same bcrypt time as a known one and response time reveals nothing. A
// cost-12 hash of a throwaway string, precomputed so boot pays nothing.
const TIMING_HASH = '$2b$12$Z4qJPy7F222SOXdBb0sDAujmpE8ObAqrWZxnwJDnId/uOsD6jzjiG'

type DbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
    private notifications: NotificationsService,
    private limits: AuthLimitsService,
  ) {}

  async register(dto: RegisterDto): Promise<{ message: string }> {
    const email = this.normalizeEmail(dto.email)

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    if (existing.length > 0) {
      throw new ConflictException('Email already registered')
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS)

    const [user] = await db
      .insert(users)
      .values({ email, passwordHash })
      .returning({ id: users.id })

    const code = this.newOtpCode()
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)

    await db.insert(otps).values({ userId: user.id, code, expiresAt })

    await this.notifications.sendOtp(email, code)

    return { message: 'Check your email for the verification code' }
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<{ accessToken: string; refreshToken: string }> {
    const [user] = await db
      .select({ id: users.id, email: users.email, isVerified: users.isVerified })
      .from(users)
      .where(eq(users.email, this.normalizeEmail(dto.email)))
      .limit(1)

    // One answer for an unknown email, a verified account and a wrong or
    // expired code, so the route does not reveal which emails exist. A
    // verified account has nothing to verify; letting it through created a
    // second workspace.
    if (!user || user.isVerified) throw new UnauthorizedException(INVALID_CODE)

    const now = new Date()

    // Reserve an attempt on the newest live code BEFORE comparing, in one
    // statement: the row lock re-checks `failed_attempts < 5`, so guesses sent
    // at the same time get at most five comparisons between them. A correct
    // guess also spends its attempt, which is harmless - it ends the code.
    const newestLive = db
      .select({ id: otps.id })
      .from(otps)
      .where(and(eq(otps.userId, user.id), gt(otps.expiresAt, now), isNull(otps.usedAt)))
      .orderBy(desc(otps.createdAt))
      .limit(1)
    const [otp] = await db
      .update(otps)
      .set({ failedAttempts: sql`${otps.failedAttempts} + 1` })
      .where(and(inArray(otps.id, newestLive), lt(otps.failedAttempts, MAX_OTP_ATTEMPTS)))
      .returning({ id: otps.id, code: otps.code, attempts: otps.failedAttempts })

    if (!otp) throw new UnauthorizedException(INVALID_CODE)

    if (!this.codesMatch(otp.code, dto.code)) {
      if (otp.attempts >= MAX_OTP_ATTEMPTS) {
        throw new UnauthorizedException('Too many wrong codes. Request a new code.')
      }
      throw new UnauthorizedException(INVALID_CODE)
    }

    return db.transaction(async (tx) => {
      // The account row is the claim: of two requests racing with right codes
      // (even two different live codes), only one flips is_verified, so only
      // one workspace is created.
      const claimed = await tx
        .update(users)
        .set({ isVerified: true })
        .where(and(eq(users.id, user.id), eq(users.isVerified, false)))
        .returning({ id: users.id })
      if (claimed.length === 0) throw new UnauthorizedException(INVALID_CODE)
      await tx.update(otps).set({ usedAt: now }).where(eq(otps.id, otp.id))

      const [workspace] = await tx
        .insert(workspaces)
        .values({
          name: `${user.email}'s workspace`,
          ownerId: user.id,
        })
        .returning({ id: workspaces.id })

      await tx.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: 'owner',
      })

      return this.issueTokens(tx, user.id, user.email)
    })
  }

  async resendOtp(dto: ResendOtpDto): Promise<{ message: string }> {
    const email = this.normalizeEmail(dto.email)
    // The same answer whatever happens below, so the route reveals nothing
    // about which emails exist or are verified.
    const answer = { message: RESEND_ANSWER }

    const [user] = await db
      .select({ id: users.id, isVerified: users.isVerified })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
    if (!user || user.isVerified) return answer
    if (!(await this.limits.takeOtpResend(email))) return answer

    const code = this.newOtpCode()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000)
    const [created] = await db.insert(otps).values({ userId: user.id, code, expiresAt }).returning({ id: otps.id })

    // Retire the older codes only once the new one is actually on its way: a
    // failed send kills the new code instead, so the user keeps a working one.
    try {
      await this.notifications.sendOtp(email, code)
    } catch (error) {
      await db.update(otps).set({ expiresAt: now }).where(eq(otps.id, created.id))
      throw error
    }
    await db
      .update(otps)
      .set({ expiresAt: now })
      .where(and(eq(otps.userId, user.id), isNull(otps.usedAt), gt(otps.expiresAt, now), ne(otps.id, created.id)))
    return answer
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }> {
    const email = this.normalizeEmail(dto.email)
    await this.limits.takeLoginAttempt(email)

    const [user] = await db
      .select({ id: users.id, email: users.email, passwordHash: users.passwordHash, isVerified: users.isVerified })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    const passwordMatch = await bcrypt.compare(dto.password, user?.passwordHash ?? TIMING_HASH)
    if (!user || !passwordMatch) throw new UnauthorizedException('Invalid credentials')

    await this.limits.clearLoginFailures(email)

    if (!user.isVerified) {
      throw new ForbiddenException('Email not verified. Check your inbox for a verification code.')
    }

    return this.issueTokens(db, user.id, user.email)
  }

  async refresh(rawToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = this.hashToken(rawToken)
    const now = new Date()

    // Fetch unconditionally (no expiry/revoked filter here) so we can tell "never existed"
    // apart from "existed but was already rotated away" — the second case is a reuse/theft signal.
    const [rt] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1)

    if (!rt) throw new UnauthorizedException('Invalid or expired refresh token')

    if (rt.revokedAt) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.userId, rt.userId), isNull(refreshTokens.revokedAt)))
      throw new UnauthorizedException('Session revoked — please log in again')
    }

    if (rt.expiresAt <= now) {
      throw new UnauthorizedException('Invalid or expired refresh token')
    }

    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, rt.userId))
      .limit(1)

    if (!user) throw new NotFoundException('User not found')

    // Revoke-old and issue-new happen as one atomic step — a crash between them
    // must never leave the user with a dead token and no replacement.
    return db.transaction(async (tx) => {
      await tx.update(refreshTokens).set({ revokedAt: now }).where(eq(refreshTokens.id, rt.id))
      return this.issueTokens(tx, user.id, user.email)
    })
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    if (!user) throw new NotFoundException('User not found')

    const passwordMatch = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!passwordMatch) throw new UnauthorizedException('Current password is incorrect')

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
    const now = new Date()

    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, userId))
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
    })

    return { message: 'Password changed. Please log in again.' }
  }

  async logout(rawToken: string): Promise<{ message: string }> {
    const tokenHash = this.hashToken(rawToken)
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash))
    return { message: 'Logged out' }
  }

  private async issueTokens(
    client: DbClient,
    userId: string,
    email: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.jwtService.sign({ sub: userId, email })

    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = this.hashToken(rawToken)
    const expiresAt = new Date(Date.now() + RT_EXPIRY_DAYS * 24 * 60 * 60 * 1000)

    await client.insert(refreshTokens).values({ userId, tokenHash, expiresAt })

    return { accessToken, refreshToken: rawToken }
  }

  // crypto.randomInt, not Math.random: a verification code must not be predictable.
  private newOtpCode(): string {
    return randomInt(100_000, 1_000_000).toString()
  }

  // Constant time: an early exit at the first wrong digit would leak how many
  // leading digits were right.
  private codesMatch(stored: string, given: string): boolean {
    const a = Buffer.from(stored)
    const b = Buffer.from(given)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase()
  }
}
