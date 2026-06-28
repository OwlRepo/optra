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
import { db, users, otps, refreshTokens } from '@repo/db'
import type { RegisterDto } from './dto/register.dto'
import type { VerifyOtpDto } from './dto/verify-otp.dto'
import type { LoginDto } from './dto/login.dto'
import { NotificationsService } from '../notifications/notifications.service'

const BCRYPT_ROUNDS = 12
const OTP_EXPIRY_MINUTES = 10
const RT_EXPIRY_DAYS = 7

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
    private notifications: NotificationsService,
  ) {}

  async register(dto: RegisterDto): Promise<{ message: string }> {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1)

    if (existing.length > 0) {
      throw new ConflictException('Email already registered')
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS)

    const [user] = await db
      .insert(users)
      .values({ email: dto.email, passwordHash })
      .returning({ id: users.id })

    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)

    await db.insert(otps).values({ userId: user.id, code, expiresAt })

    await this.notifications.sendOtp(dto.email, code)

    return { message: 'Check your email for the verification code' }
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<{ accessToken: string; refreshToken: string }> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, dto.email))
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

    await db.update(otps).set({ usedAt: now }).where(eq(otps.id, otp.id))

    await db.update(users).set({ isVerified: true }).where(eq(users.id, user.id))

    return this.issueTokens(user.id, user.email)
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1)

    if (!user) throw new UnauthorizedException('Invalid credentials')

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash)
    if (!passwordMatch) throw new UnauthorizedException('Invalid credentials')

    if (!user.isVerified) {
      throw new ForbiddenException('Email not verified. Check your inbox for a verification code.')
    }

    return this.issueTokens(user.id, user.email)
  }

  async refresh(rawToken: string): Promise<{ accessToken: string }> {
    const tokenHash = this.hashToken(rawToken)
    const now = new Date()

    const [rt] = await db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          gt(refreshTokens.expiresAt, now),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .limit(1)

    if (!rt) throw new UnauthorizedException('Invalid or expired refresh token')

    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, rt.userId))
      .limit(1)

    if (!user) throw new NotFoundException('User not found')

    const accessToken = this.jwtService.sign({ sub: user.id, email: user.email })
    return { accessToken }
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
    userId: string,
    email: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.jwtService.sign({ sub: userId, email })

    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = this.hashToken(rawToken)
    const expiresAt = new Date(Date.now() + RT_EXPIRY_DAYS * 24 * 60 * 60 * 1000)

    await db.insert(refreshTokens).values({ userId, tokenHash, expiresAt })

    return { accessToken, refreshToken: rawToken }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
}
