/** @vitest-environment jsdom */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SpotlightCard } from './spotlight-card'

describe('SpotlightCard', () => {
  it('renders its children and forwards the Card variant', () => {
    const { container } = render(
      <SpotlightCard variant="elevated" className="my-card">
        <p>Card content</p>
      </SpotlightCard>,
    )

    expect(screen.getByText('Card content')).not.toBeNull()
    expect(container.querySelector('.my-card')).not.toBeNull()
  })

  it('updates the spotlight position CSS variables on mouse move', () => {
    const { container } = render(
      <SpotlightCard>
        <p>Card content</p>
      </SpotlightCard>,
    )

    const card = container.querySelector('.group\\/spotlight') as HTMLElement
    expect(card).not.toBeNull()

    card.getBoundingClientRect = () => ({
      width: 200,
      height: 100,
      top: 0,
      left: 0,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    fireEvent.mouseMove(card, { clientX: 100, clientY: 50 })

    expect(card.style.getPropertyValue('--spot-x')).toBe('50%')
    expect(card.style.getPropertyValue('--spot-y')).toBe('50%')
  })
})
