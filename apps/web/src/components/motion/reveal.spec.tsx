/** @vitest-environment jsdom */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Reveal } from './reveal'

describe('Reveal', () => {
  it('renders its children', () => {
    render(
      <Reveal>
        <p>Hello world</p>
      </Reveal>,
    )

    expect(screen.getByText('Hello world')).not.toBeNull()
  })

  it('becomes visible immediately when IntersectionObserver is unavailable (jsdom fallback)', () => {
    const { container } = render(
      <Reveal delay={200}>
        <span>content</span>
      </Reveal>,
    )

    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('data-inview')).toBe('true')
    expect(root.className).toContain('opacity-100')
    expect(root.style.transitionDelay).toBe('200ms')
  })

  it('forwards extra props to the wrapping element', () => {
    const { container } = render(
      <Reveal className="custom-class" id="reveal-1">
        <span>content</span>
      </Reveal>,
    )

    const root = container.firstElementChild as HTMLElement
    expect(root.id).toBe('reveal-1')
    expect(root.className).toContain('custom-class')
  })
})
