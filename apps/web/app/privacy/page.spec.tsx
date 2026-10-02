/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import PrivacyPage, { metadata } from './page'

afterEach(() => {
  cleanup()
  vi.doUnmock('@/lib/legal-facts')
  vi.resetModules()
})

const BASE_FACTS = {
  SELLER_NAME: 'Romeo Angeles Jr.',
  SELLER_COUNTRY: 'Philippines',
  CONTACT_EMAIL: 'romeo@tyvera.app',
  LEGAL_LAST_UPDATED: '2026-10-02',
  DELETION_SLA_DAYS: 30,
  VPS_BACKUP_COUNT: 7,
  REFUND_WINDOW_DAYS: 14,
  TRIAL_DAYS: 14,
}

async function renderWithFacts(overrides: Record<string, unknown>) {
  vi.resetModules()
  vi.doMock('@/lib/legal-facts', () => ({
    ...BASE_FACTS,
    HOSTING_COUNTRY: null,
    OFFSITE_BACKUP_RETENTION_DAYS: null,
    LANGSMITH_TRACING_IN_PROD: null,
    ...overrides,
  }))
  const mod = await import('./page')
  return render(React.createElement(mod.default))
}

describe('Privacy page', () => {
  it('error: null hosting country and backup retention render an on-request fallback, never undefined or null', async () => {
    const { container } = await renderWithFacts({
      HOSTING_COUNTRY: null,
      OFFSITE_BACKUP_RETENTION_DAYS: null,
    })

    expect(container.textContent).toMatch(/on request/i)
    expect(container.textContent).not.toMatch(/undefined|\bnull\b/)
  })

  it('edge: a confirmed hosting country and retention are printed instead of the fallback', async () => {
    const { container } = await renderWithFacts({
      HOSTING_COUNTRY: 'Germany',
      OFFSITE_BACKUP_RETENTION_DAYS: 90,
    })

    expect(container.textContent).toContain('Germany')
    expect(container.textContent).toContain('90')
    expect(container.textContent).not.toMatch(/undefined|\bnull\b/)
  })

  it('edge: LangSmith is listed as a may-receive processor while tracing is unverified (null)', async () => {
    const { container } = await renderWithFacts({ LANGSMITH_TRACING_IN_PROD: null })

    expect(container.textContent).toContain('LangSmith')
    expect(container.textContent).toMatch(/may (receive|send|store)[^.]*(prompts|outputs)/i)
    expect(container.textContent).toMatch(/debug/i)
  })

  it('edge: LangSmith row is dropped when tracing in prod is confirmed off', async () => {
    const { container } = await renderWithFacts({ LANGSMITH_TRACING_IN_PROD: false })

    expect(container.textContent).not.toContain('LangSmith')
  })

  it('edge: LangSmith row is listed when tracing in prod is confirmed on', async () => {
    const { container } = await renderWithFacts({ LANGSMITH_TRACING_IN_PROD: true })

    expect(container.textContent).toContain('LangSmith')
  })

  it('edge: states the openai no-training and 30-day abuse-log facts', () => {
    const { container } = render(React.createElement(PrivacyPage))

    expect(container.textContent).toMatch(/not (used )?to train|does not train|not used for training/i)
    expect(container.textContent).toMatch(/30 days/)
  })

  it('regression: carries no portfolio-project claim and no unmetered cookie promises', () => {
    const { container } = render(React.createElement(PrivacyPage))

    expect(container.textContent).not.toMatch(/portfolio|advertising cookies/i)
  })

  it('happy: exports title, description and canonical metadata', () => {
    expect(metadata.title).toMatch(/Privacy/)
    expect(metadata.description).toBeTruthy()
    expect(metadata.alternates?.canonical).toMatch(/\/privacy$/)
  })

  it('happy: shows the confirmed Singapore hosting and 30 days off-site backup retention', () => {
    const { container } = render(React.createElement(PrivacyPage))

    expect(container.textContent).toContain('Singapore')
    expect(container.textContent).toMatch(/off-?site[^.]*30 days/i)
    expect(container.textContent).not.toMatch(/on request/i)
  })

  it('happy: shows h1, seller identity, contact and a Data Privacy Act basis', () => {
    const { container } = render(React.createElement(PrivacyPage))

    expect(screen.getByRole('heading', { level: 1, name: /Privacy/ })).not.toBeNull()
    expect(container.textContent).toContain('Romeo Angeles Jr.')
    expect(container.textContent).toContain('Philippines')
    expect(container.querySelector('a[href="mailto:romeo@tyvera.app"]')).not.toBeNull()
    expect(container.textContent).toContain('RA 10173')
  })

  it('happy: names every processor and both session cookies', () => {
    const { container } = render(React.createElement(PrivacyPage))

    for (const name of ['OpenAI', 'Resend', 'Backblaze B2', 'Hetzner', 'mnemra_at', 'mnemra_rt']) {
      expect(container.textContent).toContain(name)
    }
  })
})
