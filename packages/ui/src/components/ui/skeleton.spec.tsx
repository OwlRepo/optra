/** @vitest-environment jsdom */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Skeleton, SkeletonRows } from './skeleton'

afterEach(() => {
  cleanup()
})

function classesOf(element: Element | null) {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('Skeleton', () => {
  it('edge: SkeletonRows defaults to three rows of four bars', () => {
    const { container } = render(<SkeletonRows />)
    const rows = container.querySelectorAll('[data-skeleton-row]')
    expect(rows).toHaveLength(3)
    rows.forEach((row) => {
      expect(row.querySelectorAll('[data-skeleton-bar]')).toHaveLength(4)
    })
  })

  it('edge: only the first bar of each row sweeps, staggered by 0.2s per row', () => {
    const { container } = render(<SkeletonRows />)
    const rows = Array.from(container.querySelectorAll('[data-skeleton-row]'))
    rows.forEach((row, index) => {
      const bars = Array.from(row.querySelectorAll('[data-skeleton-bar]'))
      expect(classesOf(bars[0])).toContain('skeleton-sweep')
      expect((bars[0] as HTMLElement).style.getPropertyValue('--skeleton-delay')).toBe(`${index * 0.2}s`)
      bars.slice(1).forEach((bar) => {
        expect(classesOf(bar)).not.toContain('skeleton-sweep')
      })
    })
  })

  it('edge: the third column renders as a pill and the others as 8px bars', () => {
    const { container } = render(<SkeletonRows rows={1} />)
    const bars = Array.from(container.querySelectorAll('[data-skeleton-bar]'))
    expect(classesOf(bars[2])).toContain('rounded-full')
    expect(classesOf(bars[1])).toContain('rounded-[8px]')
  })

  it('regression: Skeleton is the 8px skeleton block with the teal rf-sweep, not the white shimmer', () => {
    const { container } = render(<Skeleton className="h-12" />)
    const classes = classesOf(container.firstElementChild)
    expect(classes).toEqual(expect.arrayContaining(['skeleton-sweep', 'bg-surface-skeleton', 'rounded-[8px]', 'h-12']))
    expect(classes.some((name) => name.includes('shimmer'))).toBe(false)
    expect(classes).not.toContain('rounded-2xl')
  })

  it('edge: SkeletonRows renders bars only, with no panel wrapper of its own', () => {
    const { container } = render(<SkeletonRows rows={1} className="mt-4" />)
    const root = container.firstElementChild as HTMLElement
    const classes = classesOf(root)
    expect(classes).toEqual(['mt-4'])
    expect(root.firstElementChild?.hasAttribute('data-skeleton-row')).toBe(true)
  })

  it('happy: SkeletonRows honours rows and columns and is hidden from assistive tech', () => {
    const { container } = render(<SkeletonRows rows={2} columns={6} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(classesOf(container.querySelector('[data-skeleton-row]'))).toEqual(
      expect.arrayContaining(['grid', 'gap-[18px]', 'border-t', 'border-border-inner', 'px-[18px]', 'py-4']),
    )
    const rows = container.querySelectorAll('[data-skeleton-row]')
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelectorAll('[data-skeleton-bar]')).toHaveLength(6)
    expect((rows[0] as HTMLElement).style.gridTemplateColumns).toBe('repeat(6, minmax(0, 1fr))')
  })
})
