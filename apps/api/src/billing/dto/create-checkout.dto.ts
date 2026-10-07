import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'
import type { BillingPlan } from '@repo/types'
import { SEATS_MAX, SEATS_MIN } from '../plans'

export class CreateCheckoutDto {
  @IsIn(['solo', 'team'])
  plan: BillingPlan

  @IsOptional()
  @IsInt()
  @Min(SEATS_MIN)
  @Max(SEATS_MAX)
  seats?: number
}
