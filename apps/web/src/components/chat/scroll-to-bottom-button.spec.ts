/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScrollToBottomButton } from './scroll-to-bottom-button'

describe('ScrollToBottomButton', () => {
  afterEach(() => {
    cleanup()
  })

  it('is not interactive when hidden', () => {
    const { container } = render(
      React.createElement(ScrollToBottomButton, { visible: false, onClick: vi.fn() }),
    )
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Scroll to latest message')
    expect(button?.getAttribute('aria-hidden')).toBe('true')
    expect(button?.getAttribute('tabindex')).toBe('-1')
  })

  it('calls onClick when visible and pressed', () => {
    const onClick = vi.fn()
    render(React.createElement(ScrollToBottomButton, { visible: true, onClick }))
    const button = screen.getByRole('button', { name: /scroll to latest message/i })
    expect(button.getAttribute('aria-hidden')).toBe('false')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
