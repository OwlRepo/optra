/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LEGAL_LAST_UPDATED } from '@/lib/legal-facts'

import TermsPage, { metadata } from './page'

afterEach(cleanup)

describe('Terms page', () => {
  it('error: terms title does not repeat the brand the layout template appends', () => {
    expect(metadata.title).not.toContain('— Optra')
    expect(metadata.title).not.toContain('Optra')
  })

  it('regression: seller line says "based in the Philippines", not "based in Philippines"', () => {
    const { container } = render(React.createElement(TermsPage))

    expect(container.textContent).not.toContain('based in Philippines')
    expect(container.textContent).toContain('an individual based in the Philippines')
  })

  it('edge: renders no undefined or null text from missing facts', () => {
    const { container } = render(React.createElement(TermsPage))

    expect(container.textContent).not.toMatch(/undefined|\bnull\b/)
  })

  it('error: no overage rate is promised, the plans are hard-capped', () => {
    const { container } = render(React.createElement(TermsPage))
    const text = container.textContent ?? ''

    expect(text).not.toContain('Usage above the included amount')
    expect(text).not.toMatch(/charged at the overage rate/i)
    expect(text).not.toMatch(/Extra matched line items/i)
    expect(text).toContain('There is no overage charge.')
  })

  it('error: the caps cover matched line items, photo checks and AI usage, and work stops at the cap', () => {
    const { container } = render(React.createElement(TermsPage))
    const text = container.textContent ?? ''

    expect(text).toContain(
      'Each plan includes a monthly allowance of matched line items and photo checks, as shown on the pricing page, and a monthly limit on AI usage.',
    )
    expect(text).toContain('Allowances reset each calendar month (UTC); the trial allowance covers the whole trial.')
    expect(text).toContain('When a workspace reaches a cap, that kind of work stops until the allowance resets.')
  })

  it('edge: the trial is 14 days, first workspace only, no card, with the Solo allowance', () => {
    const { container } = render(React.createElement(TermsPage))
    const text = container.textContent ?? ''

    expect(text).toContain('Your first workspace starts with a 14-day trial.')
    expect(text).toContain('The trial needs no payment card')
    expect(text).toContain("the Solo plan's allowance of matched line items and photo checks")
    expect(text).toContain('Workspaces you create later do not get a trial and need a plan.')
    expect(text).toContain('Subscribing during the trial starts your paid plan immediately.')
  })

  it('edge: says to contact us to change the plan or the number of buyers when a cap is reached', () => {
    const { container } = render(React.createElement(TermsPage))
    const paragraph =
      Array.from(container.querySelectorAll('p')).find((p) => /reach(es)? a cap/i.test(p.textContent ?? ''))
        ?.textContent ?? ''

    expect(paragraph).toMatch(/reach a cap.*contact us.*plan or (the )?number of buyers/i)
    expect(paragraph).not.toMatch(/at any time/i)
  })

  it('edge: does not promise that every discrepancy is caught', () => {
    const { container } = render(React.createElement(TermsPage))

    expect(container.textContent).toMatch(/no warranty/i)
    expect(container.textContent).toMatch(/a person decides/i)
  })

  it('regression: carries no portfolio-project or illustrative-results disclaimer', () => {
    const { container } = render(React.createElement(TermsPage))

    expect(container.textContent).not.toMatch(/portfolio|illustrative/i)
  })

  it('happy: exports title, description and canonical metadata', () => {
    expect(metadata.title).toBe('Terms of Service')
    expect(metadata.description).toBeTruthy()
    expect(metadata.alternates?.canonical).toMatch(/\/terms$/)
  })

  it('happy: shows h1, last-updated date and the seller identity', () => {
    const { container } = render(React.createElement(TermsPage))

    expect(screen.getByRole('heading', { level: 1, name: /Terms/ })).not.toBeNull()
    expect(container.textContent).toContain(LEGAL_LAST_UPDATED)
    expect(container.textContent).toContain('Romeo Angeles Jr.')
    expect(container.textContent).toContain('Philippines')
    expect(container.querySelector('a[href="mailto:romeo@tyvera.app"]')).not.toBeNull()
  })

  it('happy: names Lemon Squeezy as Merchant of Record and Philippine governing law', () => {
    const { container } = render(React.createElement(TermsPage))

    expect(container.textContent).toContain('Merchant of Record')
    expect(container.textContent).toMatch(/Republic of the Philippines/)
  })

  it('happy: links home and mounts the site footer legal links', () => {
    render(React.createElement(TermsPage))

    expect(screen.getAllByRole('link', { name: /home/i }).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe('/privacy')
  })
})
