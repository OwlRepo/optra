import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Resend } from 'resend'

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)
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
      // resend@6.16.0 never rejects on API-level failures (bad key, unverified
      // domain, rate limit) — it always resolves `{ data, error }`. The `error`
      // field must be checked explicitly or a failed send is indistinguishable
      // from a successful one to every caller.
      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: 'Your Mnemra verification code',
        html: `
          <p>Your Mnemra verification code is:</p>
          <h2>${code}</h2>
          <p>This code expires in 10 minutes.</p>
        `,
      })
      if (error) {
        this.logger.error(`Failed to send OTP email to ${email}: ${error.message}`)
        throw new InternalServerErrorException('Failed to send verification email')
      }
    } else {
      console.log(`[DEV OTP] ${email} → ${code}`)
    }
  }

  async sendInvite(email: string, inviteUrl: string): Promise<void> {
    if (this.resend) {
      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: "You're invited to a Mnemra workspace",
        html: `
          <p>You've been invited to join a Mnemra workspace.</p>
          <p><a href="${inviteUrl}">Accept your invite</a></p>
        `,
      })
      if (error) {
        this.logger.error(`Failed to send invite email to ${email}: ${error.message}`)
        throw new InternalServerErrorException('Failed to send invite email')
      }
    } else {
      console.log('[DEV INVITE] ' + email + ' -> ' + inviteUrl)
    }
  }

  // V2 F6: weekly digest email. Same resend/error-checking discipline as
  // sendOtp/sendInvite above.
  async sendDigestEmail(email: string, html: string): Promise<void> {
    if (this.resend) {
      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: 'Your Mnemra weekly digest',
        html,
      })
      if (error) {
        this.logger.error(`Failed to send digest email to ${email}: ${error.message}`)
        throw new InternalServerErrorException('Failed to send digest email')
      }
    } else {
      console.log(`[DEV DIGEST] ${email}\n${html}`)
    }
  }
}
