/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Tabs, type TabItem } from './tabs'

afterEach(() => {
  cleanup()
})

const items: TabItem[] = [
  { id: 'docs', label: 'Docs' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'chat', label: 'Chat' },
]

function setup(overrides: Partial<React.ComponentProps<typeof Tabs>> = {}) {
  const onValueChange = vi.fn()
  render(
    <Tabs
      items={items}
      value="docs"
      onValueChange={onValueChange}
      aria-label="Workspace sections"
      {...overrides}
    />,
  )
  return { onValueChange }
}

describe('Tabs', () => {
  it('renders one tab per item with correct aria-selected for the active value', () => {
    setup({ value: 'tickets' })
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(screen.getByRole('tab', { name: 'Docs' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tab', { name: 'Tickets' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('false')
  })

  it('calls onValueChange with the clicked tab id when clicking an inactive tab', () => {
    const { onValueChange } = setup({ value: 'docs' })
    fireEvent.click(screen.getByRole('tab', { name: 'Tickets' }))
    expect(onValueChange).toHaveBeenCalledWith('tickets')
  })

  it('does not call onValueChange when clicking the already-active tab', () => {
    const { onValueChange } = setup({ value: 'docs' })
    fireEvent.click(screen.getByRole('tab', { name: 'Docs' }))
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('exposes the passed aria-label on the tablist', () => {
    setup()
    expect(screen.getByRole('tablist').getAttribute('aria-label')).toBe('Workspace sections')
  })
})
