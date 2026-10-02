/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import TermsPage, { metadata } from './page'

afterEach(cleanup)

describe('Terms page', () => {
  it('edge: renders no undefined or null text from missing facts', () => {
    const { container } = render(React.createElement(TermsPage))

    expect(container.textContent).not.toMatch(/undefined|\bnull\b/)
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
    expect(metadata.title).toMatch(/Terms/)
    expect(metadata.description).toBeTruthy()
    expect(metadata.alternates?.canonical).toMatch(/\/terms$/)
  })

  it('happy: shows h1, last-updated date and the seller identity', () => {
    const { container } = render(React.createElement(TermsPage))

    expect(screen.getByRole('heading', { level: 1, name: /Terms/ })).not.toBeNull()
    expect(container.textContent).toContain('2026-10-02')
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
