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

describe('ConfidenceMeter', () => {
  it('renders a success tier fill for a high confidence value (0.9)', () => {
    const bar = setup({ value: 0.9 })
    expect(bar.getAttribute('aria-valuenow')).toBe('90')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
    const fill = bar.querySelector('[data-fill]')
    expect(fill?.className).toContain('bg-success')
  })

  it('renders a warning tier fill for a mid confidence value (0.5)', () => {
    const bar = setup({ value: 0.5 })
    const fill = bar.querySelector('[data-fill]')
    expect(fill?.className).toContain('bg-warning')
  })

  it('renders a destructive tier fill for a low confidence value (0.1)', () => {
    const bar = setup({ value: 0.1 })
    const fill = bar.querySelector('[data-fill]')
    expect(fill?.className).toContain('bg-destructive')
  })

  it('clamps out-of-range values above 1 without throwing', () => {
    expect(() => setup({ value: 1.4 })).not.toThrow()
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('100')
    const fill = bar.querySelector('[data-fill]')
    expect(fill?.className).toContain('bg-success')
  })

  it('clamps out-of-range values below 0 without throwing', () => {
    expect(() => setup({ value: -0.4 })).not.toThrow()
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('0')
    const fill = bar.querySelector('[data-fill]')
    expect(fill?.className).toContain('bg-destructive')
  })

  it('treats exactly 0.75 as success (inclusive lower bound)', () => {
    const bar = setup({ value: 0.75 })
    const fill = bar.querySelector('[data-fill]')
    expect(fill?.className).toContain('bg-success')
    expect(fill?.className).not.toContain('bg-warning')
  })

  it('treats exactly 0.4 as warning (inclusive lower bound)', () => {
    const bar = setup({ value: 0.4 })
    const fill = bar.querySelector('[data-fill]')
    expect(fill?.className).toContain('bg-warning')
    expect(fill?.className).not.toContain('bg-destructive')
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

  it('uses a shorter track height for size="sm"', () => {
    const bar = setup({ value: 0.5, size: 'sm' })
    expect(bar.className).toContain('h-1.5')
  })

  it('uses the default track height when size is not provided', () => {
    const bar = setup({ value: 0.5 })
    expect(bar.className).toContain('h-2')
  })
})
