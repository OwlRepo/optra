/** @vitest-environment jsdom */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from '@repo/ui'

describe('Modal', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders children when open and hides when closed', () => {
    const { rerender } = render(
      React.createElement(Modal, {
        open: true,
        onClose: vi.fn(),
        title: 'Test modal',
        children: React.createElement('div', undefined, 'Visible content'),
      }),
    )

    expect(screen.getByText('Visible content')).toBeDefined()

    rerender(
      React.createElement(Modal, {
        open: false,
        onClose: vi.fn(),
        title: 'Test modal',
        children: React.createElement('div', undefined, 'Visible content'),
      }),
    )

    expect(screen.queryByText('Visible content')).toBeNull()
  })

  it('calls onClose on Escape and overlay click', () => {
    const onClose = vi.fn()
    render(
      React.createElement(Modal, {
        open: true,
        onClose,
        title: 'Closable modal',
        children: React.createElement('div', undefined, 'Body'),
      }),
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement)

    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
