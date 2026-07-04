import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { eq, and, gt, isNull } from 'drizzle-orm'
import * as bcrypt from 'bcrypt'
import { createHash, randomBytes } from 'crypto'
import { db, users, otps, refreshTokens, workspaceMembers, workspaces } from '@repo/db'
import type { RegisterDto } from './dto/register.dto'
import type { VerifyOtpDto } from './dto/verify-otp.dto'
import type { LoginDto } from './dto/login.dto'
import { NotificationsService } from '../notifications/notifications.service'

const BCRYPT_ROUNDS = 12
const OTP_EXPIRY_MINUTES = 10
const RT_EXPIRY_DAYS = 7

type DbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
    private notifications: NotificationsService,
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

    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)

    await db.insert(otps).values({ userId: user.id, code, expiresAt })

    await this.notifications.sendOtp(email, code)

    return { message: 'Check your email for the verification code' }
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<{ accessToken: string; refreshToken: string }> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, this.normalizeEmail(dto.email)))
      .limit(1)

    if (!user) throw new UnauthorizedException('Invalid credentials')

    const now = new Date()

    const [otp] = await db
      .select()
      .from(otps)
      .where(
        and(
          eq(otps.userId, user.id),
          eq(otps.code, dto.code),
          gt(otps.expiresAt, now),
          isNull(otps.usedAt),
        ),
      )
      .limit(1)

    if (!otp) throw new UnauthorizedException('Invalid or expired code')

    return db.transaction(async (tx) => {
      await tx.update(otps).set({ usedAt: now }).where(eq(otps.id, otp.id))
      await tx.update(users).set({ isVerified: true }).where(eq(users.id, user.id))

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

  async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, this.normalizeEmail(dto.email)))
      .limit(1)

    if (!user) throw new UnauthorizedException('Invalid credentials')

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash)
    if (!passwordMatch) throw new UnauthorizedException('Invalid credentials')

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

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase()
  }
}
