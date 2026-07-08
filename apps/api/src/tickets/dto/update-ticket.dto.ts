import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

const severityValues = ['low', 'medium', 'high'] as const
const usefulnessValues = ['useful', 'not_useful'] as const
const editStateValues = ['accepted', 'heavily_edited'] as const

export class UpdateTicketDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  issueSummary?: string

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  reproSteps?: string

  @IsOptional()
  @IsEnum(severityValues)
  severity?: (typeof severityValues)[number]

  @IsOptional()
  @IsString()
  @MaxLength(120)
  productArea?: string

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  hypothesizedRootCause?: string

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  nextAction?: string

  @IsOptional()
  @IsEnum(usefulnessValues)
  usefulness?: (typeof usefulnessValues)[number]

  @IsOptional()
  @IsEnum(editStateValues)
  editState?: (typeof editStateValues)[number]

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  feedbackNote?: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string

  @IsOptional()
  @IsDateString()
  resolvedAt?: string

  @IsOptional()
  @IsUUID()
  assigneeId?: string
}
