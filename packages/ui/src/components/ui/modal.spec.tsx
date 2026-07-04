/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from './modal'

afterEach(() => {
  cleanup()
})

describe('Modal', () => {
  it('renders title and children when open', () => {
    render(
      <Modal open onClose={() => {}} title="Search">
        <p>Body</p>
      </Modal>,
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Search')).toBeTruthy()
    expect(screen.getByText('Body')).toBeTruthy()
  })

  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => {}}>
        <p>Body</p>
      </Modal>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('defaults to the md width (max-w-xl) for backward compatibility', () => {
    render(
      <Modal open onClose={() => {}}>
        <p>Body</p>
      </Modal>,
    )
    expect(screen.getByRole('dialog').className).toContain('max-w-xl')
  })

  it('applies a wide width when size="full" (~80% of screen)', () => {
    render(
      <Modal open onClose={() => {}} size="full">
        <p>Body</p>
      </Modal>,
    )
    const cls = screen.getByRole('dialog').className
    expect(cls).not.toContain('max-w-xl')
    expect(cls).toContain('80vw')
  })

  it('makes the body scrollable so tall content is usable', () => {
    render(
      <Modal open onClose={() => {}} title="Tall">
        <p>Body</p>
      </Modal>,
    )
    const scroll = screen.getByRole('dialog').querySelector('.overflow-y-auto')
    expect(scroll).not.toBeNull()
    expect(scroll?.textContent).toContain('Body')
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="X">
        <p>Body</p>
      </Modal>,
    )
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
