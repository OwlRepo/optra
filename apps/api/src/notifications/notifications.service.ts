import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Resend } from 'resend'

@Injectable()
export class NotificationsService {
  private resend: Resend | null = null
  private fromEmail: string

  constructor(private config: ConfigService) {
    this.fromEmail = config.get<string>('RESEND_FROM_EMAIL') ?? 'noreply@mnemra.com'
    if (config.get<string>('EMAIL_OTP_ENABLED') === 'true') {
      this.resend = new Resend(config.get<string>('RESEND_API_KEY'))
    }
  }

  async sendOtp(email: string, code: string): Promise<void> {
    if (this.resend) {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: 'Your Mnemra verification code',
        html: `
          <p>Your Mnemra verification code is:</p>
          <h2>${code}</h2>
          <p>This code expires in 10 minutes.</p>
        `,
      })
    } else {
      console.log(`[DEV OTP] ${email} → ${code}`)
    }
  }
}
