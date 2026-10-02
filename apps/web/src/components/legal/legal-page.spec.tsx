/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LegalPage, LegalTable } from './legal-page'

afterEach(cleanup)

describe('LegalTable', () => {
  it('error: the horizontal scroll wrapper is keyboard reachable and labelled by its caption', () => {
    const { container } = render(
      <LegalTable caption="Processors" headers={['Name', 'Purpose']} rows={[['A', 'B']]} />,
    )

    const region = container.querySelector('[role="region"]')
    expect(region).not.toBeNull()
    expect(region?.getAttribute('tabindex')).toBe('0')
    const labelledBy = region?.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    const caption = container.querySelector('caption')
    expect(caption?.id).toBe(labelledBy)
    expect(screen.getByRole('region', { name: 'Processors' })).not.toBeNull()
  })

  it('edge: two tables on one page get distinct caption ids', () => {
    const { container } = render(
      <>
        <LegalTable caption="One" headers={['H']} rows={[['a']]} />
        <LegalTable caption="Two" headers={['H']} rows={[['b']]} />
      </>,
    )

    const ids = Array.from(container.querySelectorAll('caption')).map((c) => c.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('LegalPage', () => {
  it('error: the header logo link has the accessible name "Optra home"', () => {
    render(<LegalPage title="Terms">body</LegalPage>)

    const link = screen.getByRole('link', { name: 'Optra home' })
    expect(link.getAttribute('href')).toBe('/')
    expect(link.textContent).toContain('Optra')
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull()
  })

  it('happy: renders the h1 and last-updated line', () => {
    render(<LegalPage title="Terms">body</LegalPage>)

    expect(screen.getByRole('heading', { level: 1, name: 'Terms' })).not.toBeNull()
    expect(screen.getByText(/Last updated:/)).not.toBeNull()
  })
})
