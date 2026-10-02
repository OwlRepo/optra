/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DefinitionRow, MetricTile } from './definition-row'

afterEach(() => {
  cleanup()
})

function classesOf(element: Element | null) {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('DefinitionRow and MetricTile', () => {
  it('edge: DefinitionRow renders without an action', () => {
    render(<DefinitionRow label="Workspace ID" value="2f1c9a4e-0b7d-4d1a-9f0e-5c2b8a7d6e31" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('2f1c9a4e-0b7d-4d1a-9f0e-5c2b8a7d6e31')).toBeTruthy()
  })

  it('edge: a breaking MetricTile takes the amber border, tint and ink', () => {
    const { container } = render(<MetricTile label="Billed" value="24" breaking />)
    const tile = container.firstElementChild
    expect(tile?.getAttribute('data-breaking')).toBe('true')
    expect(classesOf(tile)).toEqual(expect.arrayContaining(['border-flag/40', 'bg-flag/6']))
    expect(classesOf(screen.getByText('Billed'))).toContain('text-flag-strong')
    expect(classesOf(screen.getByText('24'))).toContain('text-flag-strong')
  })

  it('edge: tone="red" takes the red border, tint and ink', () => {
    const { container } = render(<MetricTile label="Billed" value="2.05" tone="red" />)
    const tile = container.firstElementChild
    expect(tile?.getAttribute('data-tone')).toBe('red')
    expect(classesOf(tile)).toEqual(expect.arrayContaining(['border-destructive-tone/35', 'bg-destructive-tone/6']))
    expect(classesOf(screen.getByText('Billed'))).toContain('text-destructive-strong-text')
    expect(classesOf(screen.getByText('2.05'))).toContain('text-destructive-strong-text')
  })

  it('edge: breaking is an alias for tone="amber", and an explicit tone wins over it', () => {
    const { container, rerender } = render(<MetricTile label="Billed" value="24" breaking />)
    expect(container.firstElementChild?.getAttribute('data-tone')).toBe('amber')
    rerender(<MetricTile label="Billed" value="24" breaking tone="red" />)
    expect(container.firstElementChild?.getAttribute('data-tone')).toBe('red')
  })

  it('edge: a regular MetricTile keeps the segmented hairline and white fill', () => {
    const { container } = render(<MetricTile label="Ordered" value="18" />)
    const tile = container.firstElementChild
    expect(tile?.hasAttribute('data-breaking')).toBe(false)
    expect(classesOf(tile)).toEqual(expect.arrayContaining(['border-border-segmented', 'bg-card']))
    expect(classesOf(screen.getByText('18'))).not.toContain('text-flag-strong')
  })

  it('happy: DefinitionRow renders the Mono teal label on the subtle fill, the Mono value and the action', () => {
    const { container } = render(
      <DefinitionRow
        label="PO"
        value="PO sheet Lines, row 6"
        action={
          <button type="button" aria-label="Download PO">
            d
          </button>
        }
      />,
    )
    expect(classesOf(container.firstElementChild)).toEqual(
      expect.arrayContaining(['grid', 'grid-cols-[110px_minmax(0,1fr)_auto]', 'border-b', 'border-border-definition', 'last:border-b-0']),
    )
    expect(classesOf(screen.getByText('PO'))).toEqual(
      expect.arrayContaining(['bg-surface-subtle', 'font-mono', 'text-[10px]', 'uppercase', 'tracking-[0.14em]', 'text-primary-strong']),
    )
    expect(classesOf(screen.getByText('PO sheet Lines, row 6'))).toEqual(expect.arrayContaining(['font-mono', 'text-[12px]']))
    expect(screen.getByRole('button', { name: 'Download PO' })).toBeTruthy()
  })

  it('happy: MetricTile renders its 11px label and Mono 17 value', () => {
    const { container } = render(<MetricTile label="Received" value="18" />)
    expect(classesOf(container.firstElementChild)).toEqual(expect.arrayContaining(['rounded-[12px]', 'border', 'p-3']))
    expect(classesOf(screen.getByText('Received'))).toEqual(
      expect.arrayContaining(['text-[11px]', 'uppercase', 'tracking-[0.1em]']),
    )
    expect(classesOf(screen.getByText('18'))).toEqual(expect.arrayContaining(['mt-[7px]', 'font-mono', 'text-[17px]']))
  })
})
