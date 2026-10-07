import { readFileSync } from 'fs'
import { join } from 'path'
import {
  SEATS_MAX,
  SEATS_MIN,
  TRIAL_DAYS,
  TRIAL_QUOTAS,
  isEntitledStatus,
  planForVariant,
  quotasFor,
  variantIdFor,
} from './plans'

const env = (values: Record<string, string | undefined>) => ({ get: (key: string) => values[key] })
const CONFIGURED = env({ LEMONSQUEEZY_VARIANT_SOLO: '9001', LEMONSQUEEZY_VARIANT_TEAM: '9002' })

describe('billing plans', () => {
  it('error: planForVariant is null for an unknown variant id', () => {
    expect(planForVariant('777', CONFIGURED)).toBeNull()
    expect(planForVariant(777, CONFIGURED)).toBeNull()
    expect(planForVariant(null, CONFIGURED)).toBeNull()
    expect(planForVariant(undefined, CONFIGURED)).toBeNull()
    expect(planForVariant('', CONFIGURED)).toBeNull()
  })

  it('error: planForVariant is null when no variant env is set', () => {
    expect(planForVariant('9001', env({}))).toBeNull()
    expect(planForVariant('9002', env({}))).toBeNull()
  })

  it.each([undefined, '', '   '])('error: variantIdFor is null when the env is unset or blank (%p)', (value) => {
    expect(variantIdFor('solo', env({ LEMONSQUEEZY_VARIANT_SOLO: value }))).toBeNull()
    expect(variantIdFor('team', env({ LEMONSQUEEZY_VARIANT_TEAM: value }))).toBeNull()
  })

  it('edge: TRIAL_DAYS equals TRIAL_DAYS in apps/web/src/lib/legal-facts.ts', () => {
    const source = readFileSync(join(__dirname, '../../../web/src/lib/legal-facts.ts'), 'utf8')
    const match = /export const TRIAL_DAYS\s*=\s*(\d+)/.exec(source)
    expect(match).not.toBeNull()
    expect(TRIAL_DAYS).toBe(Number(match![1]))
  })

  it('edge: team quotas scale with seats and solo quotas ignore seats', () => {
    expect(quotasFor('team', 1)).toEqual({ matchedLines: 2000, photoChecks: 300 })
    expect(quotasFor('team', 3)).toEqual({ matchedLines: 6000, photoChecks: 900 })
    expect(quotasFor('team', SEATS_MAX)).toEqual({ matchedLines: 50_000, photoChecks: 7500 })
    expect(quotasFor('solo', 1)).toEqual(quotasFor('solo', 9))
    expect(SEATS_MIN).toBe(1)
    expect(SEATS_MAX).toBe(25)
  })

  it('edge: past_due and on_trial are entitled, unpaid, paused and expired are not', () => {
    const now = new Date('2026-10-08T00:00:00.000Z')
    expect(isEntitledStatus('active', null, now)).toBe(true)
    expect(isEntitledStatus('past_due', null, now)).toBe(true)
    expect(isEntitledStatus('on_trial', null, now)).toBe(true)
    for (const status of ['unpaid', 'paused', 'expired', 'something_new']) {
      expect(isEntitledStatus(status, null, now)).toBe(false)
      expect(isEntitledStatus(status, new Date('2027-01-01T00:00:00.000Z'), now)).toBe(false)
    }
  })

  it('edge: cancelled is entitled before ends_at, not at or after it, and not with a null ends_at', () => {
    const now = new Date('2026-10-08T00:00:00.000Z')
    expect(isEntitledStatus('cancelled', new Date('2026-10-08T00:00:00.001Z'), now)).toBe(true)
    expect(isEntitledStatus('cancelled', new Date('2026-10-08T00:00:00.000Z'), now)).toBe(false)
    expect(isEntitledStatus('cancelled', new Date('2026-10-07T00:00:00.000Z'), now)).toBe(false)
    expect(isEntitledStatus('cancelled', null, now)).toBe(false)
  })

  it('regression: the trial quotas equal the Solo quotas', () => {
    expect(TRIAL_QUOTAS).toEqual(quotasFor('solo', 1))
  })

  it('happy: planForVariant maps the solo and team ids, including a numeric id', () => {
    expect(planForVariant('9001', CONFIGURED)).toBe('solo')
    expect(planForVariant('9002', CONFIGURED)).toBe('team')
    expect(planForVariant(9001, CONFIGURED)).toBe('solo')
    expect(planForVariant(9002, CONFIGURED)).toBe('team')
    expect(variantIdFor('solo', CONFIGURED)).toBe('9001')
  })

  it('happy: quotas are 400/100 for solo and 2000/300 per seat for team', () => {
    expect(quotasFor('solo', 1)).toEqual({ matchedLines: 400, photoChecks: 100 })
    expect(quotasFor('team', 2)).toEqual({ matchedLines: 4000, photoChecks: 600 })
  })
})
