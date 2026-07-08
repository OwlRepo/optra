import { IsBoolean, IsOptional, IsUrl } from 'class-validator'

export class UpdateDigestSettingsDto {
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  slackWebhookUrl?: string | null
}
