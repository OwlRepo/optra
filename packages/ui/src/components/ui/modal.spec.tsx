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

  it('edge: an eyebrow renders above the title as a teal Mono micro label', () => {
    render(
      <Modal open onClose={() => {}} title="Purchase order details" eyebrow="Upload · step 2 of 2">
        <p>Body</p>
      </Modal>,
    )
    const eyebrow = screen.getByText('Upload · step 2 of 2')
    expect(eyebrow.className).toContain('font-mono')
    expect(eyebrow.className).toContain('text-[10px]')
    expect(eyebrow.className).toContain('tracking-[0.14em]')
    expect(eyebrow.className).toContain('text-primary-strong')
    const heading = screen.getByRole('heading', { level: 2, name: 'Purchase order details' })
    expect(heading.className).toContain('text-[22px]')
  })

  it('edge: eyebrowTone="red" paints the confirm eyebrow in destructive red', () => {
    render(
      <Modal open onClose={() => {}} title="Remove member" eyebrow="Confirm" eyebrowTone="red">
        <p>Body</p>
      </Modal>,
    )
    const eyebrow = screen.getByText('Confirm')
    expect(eyebrow.className).toContain('text-destructive-strong-text')
    expect(eyebrow.className).not.toContain('text-primary-strong')
  })

  it('edge: headerAccessory renders beside the title', () => {
    render(
      <Modal open onClose={() => {}} title="NG-SW20" headerAccessory={<span>Quantity mismatch</span>}>
        <p>Body</p>
      </Modal>,
    )
    const heading = screen.getByRole('heading', { level: 2, name: 'NG-SW20' })
    expect(heading.parentElement?.textContent).toContain('Quantity mismatch')
  })

  it('edge: aria-label overrides the title-derived name and titleClassName/bodyClassName reach the title and body', () => {
    render(
      <Modal
        open
        onClose={() => {}}
        title="NG-SW20"
        aria-label="Review discrepancy"
        titleClassName="font-mono font-medium"
        bodyClassName="p-0"
      >
        <p>Body</p>
      </Modal>,
    )
    expect(screen.getByRole('dialog', { name: 'Review discrepancy' })).toBeTruthy()
    const heading = screen.getByRole('heading', { level: 2, name: 'NG-SW20' })
    expect(heading.className).toContain('font-mono')
    expect(heading.className).toContain('leading-[normal]')
    const body = screen.getByText('Body').parentElement as HTMLElement
    expect(body.className).toContain('p-0')
    expect(body.className).not.toContain('px-[26px]')
    expect(body.className).toContain('overflow-y-auto')
  })

  it('edge: without aria-label the dialog is still named by its title', () => {
    render(
      <Modal open onClose={() => {}} title="Create workspace">
        <p>Body</p>
      </Modal>,
    )
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Create workspace')
  })

  it('edge: the header close button calls onClose once', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Create workspace">
        <p>Body</p>
      </Modal>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('edge: without a title or eyebrow there is no header and no close button', () => {
    render(
      <Modal open onClose={() => {}}>
        <p>Body</p>
      </Modal>,
    )
    expect(screen.queryByRole('button', { name: 'Close dialog' })).toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('regression: the panel is the 20px hairline demo panel with the modal shadow over an ink backdrop', () => {
    render(
      <Modal open onClose={() => {}} title="Create workspace">
        <p>Body</p>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('rounded-[20px]')
    expect(dialog.className).toContain('border-border-panel')
    expect(dialog.className).toContain('shadow-modal')
    const backdrop = dialog.parentElement as HTMLElement
    expect(backdrop.className).toContain('bg-foreground/40')
    expect(backdrop.className).toContain('backdrop-blur-[4px]')
    expect(backdrop.className).not.toContain('bg-slate-950/55')
  })

  it('regression: the footer sits on the subtle fill, right-aligned', () => {
    render(
      <Modal open onClose={() => {}} title="Create workspace" footer={<button type="button">Create workspace</button>}>
        <p>Body</p>
      </Modal>,
    )
    const footer = screen.getByRole('button', { name: 'Create workspace' }).parentElement as HTMLElement
    expect(footer.className).toContain('bg-surface-subtle')
    expect(footer.className).toContain('border-border-inner')
    expect(footer.className).toContain('justify-end')
    expect(footer.className).toContain('px-[26px]')
  })
})
