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
  FILE_STORAGE_REGION: 'United States (Backblaze B2 us-east-005)',
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
  it('error: privacy title does not repeat the brand the layout template appends', () => {
    expect(metadata.title).not.toContain('— Optra')
    expect(metadata.title).not.toContain('Optra')
  })

  it('regression: seller line says "based in the Philippines", not "based in Philippines"', () => {
    const { container } = render(React.createElement(PrivacyPage))

    expect(container.textContent).not.toContain('based in Philippines')
    expect(container.textContent).toContain('an individual based in the Philippines')
  })

  it('regression: old deletion wording and the OpenAI-only-documents scope are gone', () => {
    const { container } = render(React.createElement(PrivacyPage))

    expect(container.textContent).not.toContain('files, matches and history within 30 days')
    expect(container.textContent).not.toMatch(/Rate limiting and abuse protection\.(?! and)/)
  })

  it('regression: the privacy policy does not refer to itself as the privacy policy', () => {
    const { container } = render(React.createElement(PrivacyPage))

    expect(container.textContent).not.toContain('schedule in the privacy policy')
  })

  it('error: the storage sentence renders the region once, without a doubled United States', () => {
    const { container } = render(React.createElement(PrivacyPage))

    expect(container.textContent).not.toContain('United States (United States')
    expect(container.textContent).toContain(
      'Uploaded files and backups are stored in the United States (Backblaze B2 us-east-005).',
    )
  })

  it('edge: states the deletion promise with the backup-expiry pointer', () => {
    const { container } = render(React.createElement(PrivacyPage))

    expect(container.textContent).toContain(
      'Email us and we delete your workspace data, including uploaded files, within 30 days. Backups expire on the schedule below.',
    )
  })

  it('edge: the processor file-storage region is printed from FILE_STORAGE_REGION', async () => {
    const { container } = await renderWithFacts({ FILE_STORAGE_REGION: 'Mars (Test B2 x-001)' })

    expect(container.textContent).toContain('Mars (Test B2 x-001)')
    expect(container.textContent).not.toMatch(/undefined|\bnull\b/)
  })

  it('happy: OpenAI row covers documents, photos and chat, and names OpenAI, L.L.C. in the United States', () => {
    const { container } = render(React.createElement(PrivacyPage))

    expect(container.textContent).toContain(
      'Text and page images of uploaded documents (including photos of paper documents, with location data removed first), product photos, and questions you type into chat with the passages retrieved to answer them',
    )
    expect(container.textContent).toMatch(/OpenAI, L\.L\.C\./)
    expect(container.textContent).toMatch(/OpenAI, L\.L\.C\.[^.]*United States/)
  })

  it('happy: data-we-collect lists chat, tickets, crawled pages, decisions, activity and members', () => {
    const { container } = render(React.createElement(PrivacyPage))
    const text = container.textContent ?? ''

    expect(text).toMatch(/chat messages/i)
    expect(text).toMatch(/tickets extracted from your documents/i)
    expect(text).toMatch(/web pages you ask us to crawl/i)
    expect(text).toMatch(/decision history/i)
    expect(text).toMatch(/outcome, note, who decided and their role/i)
    expect(text).toMatch(/workspace activity events/i)
    expect(text).toMatch(/workspace member emails and roles/i)
  })

  it('happy: Backblaze row says file storage and off-site backups, with the US region and Singapore server', () => {
    const { container } = render(React.createElement(PrivacyPage))
    const text = container.textContent ?? ''

    expect(text).toContain('File storage and off-site backups')
    expect(text).toContain('United States (Backblaze B2 us-east-005)')
    expect(text).toMatch(/uploaded files and backups are stored in the United States/i)
    expect(text).toMatch(/application server runs in Singapore/i)
  })

  it('happy: IP row covers rate limiting, abuse protection and self-hosted Umami analytics', () => {
    const { container } = render(React.createElement(PrivacyPage))

    expect(container.textContent).toContain(
      'Rate limiting and abuse protection, and site analytics (Umami, self-hosted)',
    )
  })

  it('happy: cookies section calls mnemra_session_active a session-storage flag, not a cookie', () => {
    const { container } = render(React.createElement(PrivacyPage))
    const text = container.textContent ?? ''

    expect(text).toContain('mnemra_session_active')
    expect(text).toMatch(/mnemra_session_active[^.]*session-storage flag, not a cookie/i)
    expect(text).toMatch(/clears when the (browser )?tab closes/i)
  })

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

  it('error: the Lemon Squeezy row renders from fixed copy even when every optional fact is null', async () => {
    const { container } = await renderWithFacts({})

    expect(container.textContent).toContain('Lemon Squeezy')
    expect(container.textContent).not.toMatch(/undefined|\bnull\b/)
  })

  it('edge: data-we-collect lists the stored Lemon Squeezy billing events with the payer name and email', () => {
    const { container } = render(React.createElement(PrivacyPage))
    const text = container.textContent ?? ''

    expect(text).toContain(
      'Billing events from Lemon Squeezy (plan, status, renewal dates, and the payer name and email in the event)',
    )
    expect(text).toContain('Keep your subscription status accurate and investigate billing problems.')
  })

  it('edge: retention says billing records (payer name and email) are kept for tax and accounting and removed on request', () => {
    render(React.createElement(PrivacyPage))
    const heading = screen.getByRole('heading', { name: /how long we keep it/i })
    const section = heading.closest('section')
    const text = section?.textContent ?? ''

    expect(section).not.toBeNull()
    expect(text).toMatch(/billing records/i)
    expect(text).toMatch(/payer name and email/i)
    expect(text).toMatch(/tax and accounting/i)
    expect(text).toMatch(/on request/i)
  })

  it('happy: Lemon Squeezy is a processor as Merchant of Record and the row says what each side sends', () => {
    const { container } = render(React.createElement(PrivacyPage))
    const text = container.textContent ?? ''

    expect(text).toContain('Payments, tax and invoices, as our Merchant of Record.')
    expect(text).toContain(
      'We send it your email address and a workspace identifier; it sends us your plan, subscription status, renewal dates and the payer name and email.',
    )
  })

  it('happy: exports title, description and canonical metadata', () => {
    expect(metadata.title).toBe('Privacy Policy')
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
