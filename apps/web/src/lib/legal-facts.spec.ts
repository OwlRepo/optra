import { describe, expect, it } from 'vitest'
import * as facts from '@/lib/legal-facts'

describe('legal-facts', () => {
  it('edge: LangSmith tracing stays null (unverified), never a guessed boolean', () => {
    expect(facts.LANGSMITH_TRACING_IN_PROD).toBeNull()
  })

  it('edge: owner-confirmed preflight facts are exact', () => {
    expect(facts.HOSTING_COUNTRY).toBe('Singapore')
    expect(facts.OFFSITE_BACKUP_RETENTION_DAYS).toBe(30)
  })

  it('edge: exports no constant beyond the documented set', () => {
    expect(Object.keys(facts).sort()).toEqual(
      [
        'CONTACT_EMAIL',
        'DELETION_SLA_DAYS',
        'HOSTING_COUNTRY',
        'LANGSMITH_TRACING_IN_PROD',
        'LEGAL_LAST_UPDATED',
        'OFFSITE_BACKUP_RETENTION_DAYS',
        'REFUND_WINDOW_DAYS',
        'SELLER_COUNTRY',
        'SELLER_NAME',
        'TRIAL_DAYS',
        'VPS_BACKUP_COUNT',
      ].sort(),
    )
  })

  it('happy: seller, contact and policy constants are exact', () => {
    expect(facts.SELLER_NAME).toBe('Romeo Angeles Jr.')
    expect(facts.SELLER_COUNTRY).toBe('Philippines')
    expect(facts.CONTACT_EMAIL).toBe('romeo@tyvera.app')
    expect(facts.LEGAL_LAST_UPDATED).toBe('2026-10-02')
    expect(facts.DELETION_SLA_DAYS).toBe(30)
    expect(facts.VPS_BACKUP_COUNT).toBe(7)
    expect(facts.REFUND_WINDOW_DAYS).toBe(14)
    expect(facts.TRIAL_DAYS).toBe(14)
  })
})
