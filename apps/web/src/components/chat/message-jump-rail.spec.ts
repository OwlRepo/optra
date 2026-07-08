/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageJumpRail } from './message-jump-rail'

describe('MessageJumpRail', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders nothing for fewer than 2 items', () => {
    const { container } = render(
      React.createElement(MessageJumpRail, { items: [{ id: '1', label: 'Only one' }], onJump: vi.fn() }),
    )
    expect(container.innerHTML).toBe('')
  })

  it('truncates long labels and calls onJump with the matching id', () => {
    const onJump = vi.fn()
    const longLabel = 'A'.repeat(50)
    render(
      React.createElement(MessageJumpRail, {
        items: [
          { id: 'a', label: 'Short one' },
          { id: 'b', label: longLabel },
        ],
        onJump,
      }),
    )

    expect(screen.getByText(`${'A'.repeat(25)}…`)).toBeTruthy()

    fireEvent.click(screen.getByText('Short one'))
    expect(onJump).toHaveBeenCalledWith('a')
  })
})
