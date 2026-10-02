/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EmptyState } from './empty-state'

afterEach(() => {
  cleanup()
})

function classesOf(element: Element | null) {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('EmptyState', () => {
  it('edge: the teal "good news" label carries a check and the teal-hover ink', () => {
    render(
      <EmptyState
        label="All clear"
        labelTone="teal"
        title="No discrepancies"
        description="Every checked line item matches."
      />,
    )
    const label = screen.getByText('All clear')
    expect(classesOf(label)).toEqual(
      expect.arrayContaining(['font-mono', 'text-[10px]', 'uppercase', 'tracking-[0.14em]', 'text-primary-strong-hover']),
    )
    expect(label.querySelector('svg')).not.toBeNull()
  })

  it('edge: amber, neutral and muted labels take their tones without a check', () => {
    render(
      <>
        <EmptyState label="Needs a vendor first" labelTone="amber" title="No vendors yet" description="Create one first." />
        <EmptyState label="Owners & admins" labelTone="neutral" title="Invite controls hidden" description="Only owners and admins can invite." />
        <EmptyState label="pdf / xlsx / csv" title="No purchase orders yet" description="Upload a purchase order." />
      </>,
    )
    expect(classesOf(screen.getByText('Needs a vendor first'))).toContain('text-flag-strong')
    expect(classesOf(screen.getByText('Owners & admins'))).toContain('text-ink-neutral')
    expect(classesOf(screen.getByText('pdf / xlsx / csv'))).toContain('text-ink-muted')
    expect(screen.getByText('Needs a vendor first').querySelector('svg')).toBeNull()
  })

  it('edge: the description runs full width unless the screen caps it (frames 2.7-3.11 vs 2.3)', () => {
    render(<EmptyState title="No vendors yet" description="Add a vendor first." />)
    expect(classesOf(screen.getByText('Add a vendor first.')).some((name) => name.startsWith('max-w-'))).toBe(false)
    cleanup()
    render(<EmptyState title="No purchase orders yet" description="Upload one." descriptionClassName="max-w-[52ch]" />)
    expect(classesOf(screen.getByText('Upload one.'))).toContain('max-w-[52ch]')
  })

  it('edge: the icon prop is accepted but not rendered', () => {
    render(<EmptyState icon={<svg data-testid="empty-icon" />} title="No photos yet" description="Photos will appear here once available." />)
    expect(screen.queryByTestId('empty-icon')).toBeNull()
  })

  it('edge: a nested empty state uses the 14px radius', () => {
    const { container } = render(<EmptyState nested title="No vendors yet" description="Create one first." />)
    const classes = classesOf(container.firstElementChild)
    expect(classes).toContain('rounded-[14px]')
    expect(classes).not.toContain('rounded-[18px]')
  })

  it('regression: the empty state is a flush-left white dashed well, not a centred tinted box', () => {
    const { container } = render(<EmptyState title="No purchase orders yet" description="Upload a purchase order." />)
    const classes = classesOf(container.firstElementChild)
    expect(classes).toEqual(
      expect.arrayContaining(['border', 'border-dashed', 'border-border-dashed', 'rounded-[18px]', 'bg-card', 'p-7']),
    )
    expect(classes).not.toContain('text-center')
    expect(classes).not.toContain('items-center')
  })

  it('happy: renders the 20px h3 title, 15px body copy and the actions row', () => {
    render(
      <EmptyState
        label="pdf / xlsx / csv"
        title="No purchase orders yet"
        description="Upload a CSV, XLSX, or PDF purchase order to compare it against an invoice."
        actions={<button type="button">Upload purchase order</button>}
      />,
    )
    expect(classesOf(screen.getByRole('heading', { level: 3, name: 'No purchase orders yet' }))).toEqual(
      expect.arrayContaining(['text-[20px]', 'mt-3', 'leading-[normal]']),
    )
    expect(
      classesOf(screen.getByText('Upload a CSV, XLSX, or PDF purchase order to compare it against an invoice.')),
    ).toEqual(expect.arrayContaining(['mt-2', 'text-[15px]', 'leading-[1.6]', 'text-ink-body']))
    expect(classesOf(screen.getByRole('button', { name: 'Upload purchase order' }).parentElement)).toContain('mt-[18px]')
  })
})
