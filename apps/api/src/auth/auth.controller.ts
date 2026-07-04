import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { AuthService } from './auth.service'
import { RegisterDto } from './dto/register.dto'
import { VerifyOtpDto } from './dto/verify-otp.dto'
import { LoginDto } from './dto/login.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { CurrentUser, type CurrentUserContext } from './decorators/current-user.decorator'
import { JwtAuthGuard } from './guards/jwt-auth.guard'

const RT_COOKIE = 'mnemra_rt'
const RT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const TEN_MINUTES_MS = 10 * 60 * 1000

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: TEN_MINUTES_MS } })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto)
  }

  @Post('verify-otp')
  @Throttle({ default: { limit: 5, ttl: TEN_MINUTES_MS } })
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } = await this.authService.verifyOtp(dto)
    this.setRtCookie(res, refreshToken)
    return { accessToken }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: TEN_MINUTES_MS } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } = await this.authService.login(dto)
    this.setRtCookie(res, refreshToken)
    return { accessToken }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: TEN_MINUTES_MS } })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken = req.cookies[RT_COOKIE]
    if (!rawToken) throw new UnauthorizedException('No refresh token')
    const { accessToken, refreshToken } = await this.authService.refresh(rawToken)
    this.setRtCookie(res, refreshToken)
    return { accessToken }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken = req.cookies[RT_COOKIE]
    if (rawToken) {
      await this.authService.logout(rawToken)
    }
    res.clearCookie(RT_COOKIE, { path: '/' })
    return { message: 'Logged out' }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: CurrentUserContext) {
    return user
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser() user: CurrentUserContext,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.changePassword(
      user.userId,
      dto.currentPassword,
      dto.newPassword,
    )
    res.clearCookie(RT_COOKIE, { path: '/' })
    return result
  }

  private setRtCookie(res: Response, token: string) {
    res.cookie(RT_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: RT_MAX_AGE_MS,
      path: '/',
    })
  }
}
