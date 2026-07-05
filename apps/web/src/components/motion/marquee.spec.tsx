/** @vitest-environment jsdom */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Marquee } from './marquee'

describe('Marquee', () => {
  it('duplicates its children so the scroll loop reads seamlessly', () => {
    render(
      <Marquee>
        <span>Item A</span>
      </Marquee>,
    )

    expect(screen.getAllByText('Item A')).toHaveLength(2)
  })

  it('marks the duplicated copy as aria-hidden so screen readers only hear it once', () => {
    const { container } = render(
      <Marquee>
        <span>Item A</span>
      </Marquee>,
    )

    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('reverses the animation direction when requested', () => {
    const { container } = render(
      <Marquee reverse>
        <span>Item A</span>
      </Marquee>,
    )

    const track = container.querySelector('.animate-marquee') as HTMLElement
    expect(track.style.animationDirection).toBe('reverse')
  })
})
