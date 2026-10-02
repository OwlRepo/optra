/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatusBanner } from './status-banner'

afterEach(() => {
  cleanup()
})

function classesOf(element: Element | null) {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('StatusBanner', () => {
  it('error: an error banner is announced as an alert', () => {
    render(<StatusBanner variant="error" title="Failed to load discrepancies" />)
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('edge: every non-error variant, including the new warning, is a polite status region', () => {
    const variants = ['info', 'success', 'warning', 'loading'] as const
    for (const variant of variants) {
      render(<StatusBanner variant={variant} title={`Banner ${variant}`} />)
      const region = screen.getByRole('status')
      expect(region.getAttribute('aria-live')).toBe('polite')
      cleanup()
    }
  })

  it('edge: warning is the amber tone with its 3px rule', () => {
    render(<StatusBanner variant="warning" title="Receipt still processing" />)
    expect(classesOf(screen.getByRole('status'))).toEqual(
      expect.arrayContaining(['border-flag/30', 'bg-flag/6', 'inset-shadow-[3px_0_0_var(--flag)]']),
    )
  })

  it('regression: the error banner is a 12px red-tinted strip with a 3px inset rule', () => {
    render(<StatusBanner variant="error" title="Failed to load discrepancies" />)
    const classes = classesOf(screen.getByRole('alert'))
    expect(classes).toEqual(
      expect.arrayContaining([
        'rounded-[12px]',
        'border',
        'px-4',
        'py-[14px]',
        'border-destructive-tone/30',
        'bg-destructive-tone/6',
        'inset-shadow-[3px_0_0_var(--destructive-tone)]',
      ]),
    )
    expect(classes).not.toContain('text-destructive')
  })

  it('regression: title is 14px semibold ink and the description reads in body ink, not tinted opacity', () => {
    render(<StatusBanner variant="success" title="A new code was sent." description="Check your inbox." />)
    expect(classesOf(screen.getByText('A new code was sent.'))).toEqual(
      expect.arrayContaining(['text-[14px]', 'font-semibold']),
    )
    const description = classesOf(screen.getByText('Check your inbox.'))
    expect(description).toEqual(expect.arrayContaining(['mt-[3px]', 'text-[14px]', 'text-ink-body']))
    expect(description).not.toContain('opacity-80')
  })

  it('happy: renders the trailing action', () => {
    render(
      <StatusBanner
        variant="error"
        title="Failed to load discrepancies"
        description="Try again in a moment."
        action={<button type="button">Retry</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
