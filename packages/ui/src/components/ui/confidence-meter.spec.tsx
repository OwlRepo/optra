/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfidenceMeter } from './confidence-meter'

afterEach(() => {
  cleanup()
})

function setup(overrides: Partial<React.ComponentProps<typeof ConfidenceMeter>> = {}) {
  render(<ConfidenceMeter value={0.5} {...overrides} />)
  return screen.getByRole('progressbar')
}

function classesOf(element: Element | null) {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('ConfidenceMeter', () => {
  it('edge: clamps values above 1 to 100 without throwing and keeps the teal fill', () => {
    expect(() => setup({ value: 1.4 })).not.toThrow()
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('100')
    expect(classesOf(bar.querySelector('[data-fill]'))).toContain('bg-primary-strong')
  })

  it('edge: clamps values below 0 to 0 without throwing and keeps the red fill', () => {
    expect(() => setup({ value: -0.4 })).not.toThrow()
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('0')
    expect(classesOf(bar.querySelector('[data-fill]'))).toContain('bg-destructive-tone')
  })

  it('edge: treats exactly 0.75 as teal (inclusive lower bound)', () => {
    const bar = setup({ value: 0.75 })
    const fill = classesOf(bar.querySelector('[data-fill]'))
    expect(fill).toContain('bg-primary-strong')
    expect(fill).not.toContain('bg-flag')
  })

  it('edge: treats exactly 0.4 as amber (inclusive lower bound)', () => {
    const bar = setup({ value: 0.4 })
    const fill = classesOf(bar.querySelector('[data-fill]'))
    expect(fill).toContain('bg-flag')
    expect(fill).not.toContain('bg-destructive-tone')
  })

  it('regression: renders a teal (primary-strong) fill for a high confidence value (0.9)', () => {
    const bar = setup({ value: 0.9 })
    expect(bar.getAttribute('aria-valuenow')).toBe('90')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
    const fill = classesOf(bar.querySelector('[data-fill]'))
    expect(fill).toContain('bg-primary-strong')
    expect(fill).not.toContain('bg-success')
  })

  it('regression: renders an amber (flag) fill for a mid confidence value (0.5)', () => {
    const bar = setup({ value: 0.5 })
    const fill = classesOf(bar.querySelector('[data-fill]'))
    expect(fill).toContain('bg-flag')
    expect(fill).not.toContain('bg-warning')
  })

  it('regression: renders a red (destructive-tone) fill for a low confidence value (0.1)', () => {
    const bar = setup({ value: 0.1 })
    expect(classesOf(bar.querySelector('[data-fill]'))).toContain('bg-destructive-tone')
  })

  it('regression: uses the 4px definition-rule track with a 3px radius for size="sm"', () => {
    const bar = setup({ value: 0.5, size: 'sm' })
    const track = classesOf(bar)
    expect(track).toEqual(expect.arrayContaining(['h-1', 'rounded-[3px]', 'bg-border-definition']))
    expect(track).not.toContain('h-1.5')
  })

  it('regression: uses the same 4px track when size is not provided', () => {
    const bar = setup({ value: 0.5 })
    const track = classesOf(bar)
    expect(track).toContain('h-1')
    expect(track).not.toContain('h-2')
  })

  it('defaults aria-label and visible label to a rounded percentage', () => {
    setup({ value: 0.82 })
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toBe('Confidence 82%')
    expect(screen.getByText('82%')).toBeTruthy()
  })

  it('accepts a label override for both aria-label and visible text', () => {
    setup({ value: 0.82, label: 'High match' })
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toBe('High match')
    expect(screen.getByText('High match')).toBeTruthy()
  })

  it('happy: md leads with the 84px "Confidence" micro label and sm with the compact "Conf." label', () => {
    setup({ value: 0.92 })
    const long = screen.getByText('Confidence')
    expect(long.getAttribute('aria-hidden')).toBe('true')
    expect(classesOf(long)).toEqual(
      expect.arrayContaining(['w-[84px]', 'font-mono', 'text-[10px]', 'uppercase', 'tracking-[0.1em]', 'text-ink-muted']),
    )
    expect(classesOf(screen.getByText('92%'))).toEqual(expect.arrayContaining(['font-mono', 'text-[12px]', 'w-10', 'text-right']))
    cleanup()
    setup({ value: 0.61, size: 'sm' })
    expect(screen.getByText('Conf.').getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByText('Confidence')).toBeNull()
  })
})
