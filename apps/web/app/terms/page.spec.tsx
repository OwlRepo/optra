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

  it('error: photo checks are hard-capped, not billed as overage', () => {
    const { container } = render(React.createElement(TermsPage))

    expect(container.textContent).not.toContain('Usage above the included amount')
    expect(container.textContent).toContain(
      "Extra matched line items are charged at the overage rate shown for your plan. Photo checks stop at your plan's cap.",
    )
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
