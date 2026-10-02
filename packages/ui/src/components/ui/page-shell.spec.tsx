/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PageShell } from './page-shell'

afterEach(() => {
  cleanup()
})

describe('PageShell', () => {
  it('regression: renders no noise, grid or blob decoration layers', () => {
    const { container } = render(
      <PageShell>
        <p>Content</p>
      </PageShell>,
    )
    expect(container.querySelector('.noise-overlay')).toBeNull()
    expect(container.querySelector('.app-grid')).toBeNull()
    expect(container.querySelector('.blur-3xl')).toBeNull()
    expect(container.querySelectorAll('.pointer-events-none')).toHaveLength(0)
  })

  it('happy: children render inside the centred container with contentClassName', () => {
    const { container } = render(
      <PageShell className="py-10" contentClassName="max-w-3xl">
        <p>Content</p>
      </PageShell>,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('py-10')
    const inner = screen.getByText('Content').parentElement as HTMLElement
    expect(inner.className).toContain('mx-auto')
    expect(inner.className).toContain('max-w-3xl')
  })
})
