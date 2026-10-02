/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatCard, StatStrip } from './stat-card'

afterEach(() => {
  cleanup()
})

function classesOf(element: Element | null) {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('StatCard and StatStrip', () => {
  it('edge: a toned StatStrip value takes its tone only when it is above zero', () => {
    render(
      <StatStrip
        items={[
          { label: 'Price mismatches', value: 7, tone: 'red' },
          { label: 'Quantity mismatches', value: 4, tone: 'amber' },
          { label: 'Receiving exceptions', value: 0, tone: 'amber' },
        ]}
      />,
    )
    expect(classesOf(screen.getByText('7'))).toContain('text-destructive-strong-text')
    expect(classesOf(screen.getByText('4'))).toContain('text-flag-text')
    const zero = classesOf(screen.getByText('0'))
    expect(zero).toContain('text-foreground')
    expect(zero).not.toContain('text-flag-text')
  })

  it('edge: an untoned StatStrip value stays ink', () => {
    render(<StatStrip items={[{ label: 'Needs review', value: 2 }]} />)
    expect(classesOf(screen.getByText('2'))).toContain('text-foreground')
  })

  it('edge: StatCard accepts an icon but does not render it', () => {
    render(<StatCard label="Orders" value={38} icon={<svg data-testid="stat-icon" />} />)
    expect(screen.queryByTestId('stat-icon')).toBeNull()
  })

  it('edge: StatStrip draws inner rules between cells and never after the last one on desktop', () => {
    const { container } = render(
      <StatStrip
        items={[
          { label: 'Quantity mismatches', value: 4, tone: 'amber' },
          { label: 'Price mismatches', value: 7, tone: 'red' },
          { label: 'Needs review', value: 2 },
        ]}
      />,
    )
    const cells = container.querySelectorAll('[data-stat-cell]')
    expect(cells).toHaveLength(3)
    expect(classesOf(cells[0])).toContain('lg:border-r')
    expect(classesOf(cells[2])).toContain('lg:border-r-0')
    expect(classesOf(container.firstElementChild)).toEqual(
      expect.arrayContaining(['grid-cols-2', 'lg:grid-cols-3', 'border-border-panel', 'bg-card', 'overflow-hidden']),
    )
  })

  it('regression: StatCard is a hairline panel cell with the 30px Outfit value', () => {
    const { container } = render(<StatCard label="Orders" value={38} />)
    const root = classesOf(container.firstElementChild)
    expect(root).toEqual(expect.arrayContaining(['border-border-panel', 'bg-card', 'rounded-[18px]']))
    expect(root.some((name) => name.includes('shadow') || name.includes('backdrop-blur'))).toBe(false)
    expect(classesOf(screen.getByText('38'))).toEqual(
      expect.arrayContaining(['font-display', 'text-[30px]', 'font-semibold', 'tracking-[-0.03em]']),
    )
  })

  it('regression: StatCard label is 13px muted ink', () => {
    render(<StatCard label="Fallback rate" value="12%" />)
    expect(classesOf(screen.getByText('Fallback rate'))).toEqual(expect.arrayContaining(['text-[13px]', 'text-ink-muted']))
  })

  it('happy: StatStrip renders each label, value and the hint in its trend colour', () => {
    render(
      <StatStrip
        items={[
          { label: 'Orders', value: 38, hint: 'vs last week', trend: 'up' },
          { label: 'Priced off contract', value: 3, tone: 'amber', hint: 'more than usual', trend: 'down' },
        ]}
      />,
    )
    expect(screen.getByText('Orders')).toBeTruthy()
    expect(screen.getByText('38')).toBeTruthy()
    expect(classesOf(screen.getByText('vs last week').parentElement)).toContain('text-primary-strong-hover')
    expect(classesOf(screen.getByText('more than usual').parentElement)).toContain('text-destructive-strong-text')
  })
})
