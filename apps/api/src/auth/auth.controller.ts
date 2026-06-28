import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { AuthService } from './auth.service'
import { RegisterDto } from './dto/register.dto'
import { VerifyOtpDto } from './dto/verify-otp.dto'
import { LoginDto } from './dto/login.dto'

const RT_COOKIE = 'mnemra_rt'
const RT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto)
  }

  @Post('verify-otp')
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
  async refresh(@Req() req: Request) {
    const rawToken = req.cookies[RT_COOKIE]
    if (!rawToken) throw new UnauthorizedException('No refresh token')
    return this.authService.refresh(rawToken)
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
