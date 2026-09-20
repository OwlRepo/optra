import { IsIn, IsString, MaxLength, MinLength } from 'class-validator'

// POLICY v1 #7. The note is required here, unlike the legacy dismiss route,
// which takes no body and records a system note on the caller's behalf.
export class RecordDecisionDto {
  @IsIn(['false_positive', 'approved_exception', 'vendor_dispute', 'resolved'])
  outcome!: 'false_positive' | 'approved_exception' | 'vendor_dispute' | 'resolved'

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note!: string
}
