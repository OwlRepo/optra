/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SegmentedControl, Tabs, type TabItem } from './tabs'

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

  it('edge: a tab count renders in Mono 11 and stays out of the accessible name', () => {
    render(
      <Tabs
        items={[
          { id: 'po', label: 'Purchase Orders', count: 5 },
          { id: 'inv', label: 'Invoices', count: 3 },
        ]}
        value="po"
        onValueChange={() => {}}
        aria-label="Document type"
      />,
    )
    const count = screen.getByText('5')
    expect(count.getAttribute('aria-hidden')).toBe('true')
    expect(count.className).toContain('font-mono')
    expect(count.className).toContain('text-[11px]')
    expect(screen.getByRole('tab', { name: 'Purchase Orders' })).toBeTruthy()
  })

  it('edge: shortLabel shows below lg and keeps the full accessible name', () => {
    setup({
      items: [
        { id: 'docs', label: 'Purchase Orders', shortLabel: 'POs' },
        { id: 'tickets', label: 'Tickets' },
      ],
    })
    const tab = screen.getByRole('tab', { name: 'Purchase Orders' })
    const short = screen.getByText('POs')
    expect(short.className).toContain('lg:hidden')
    expect(screen.getByText('Purchase Orders').className).toContain('hidden lg:inline')
    expect(tab.contains(short)).toBe(true)
    expect(screen.getByRole('tab', { name: 'Tickets' }).getAttribute('aria-label')).toBeNull()
  })

  it('edge: fullWidth stretches the track and its tabs below lg', () => {
    setup({ fullWidth: true })
    const tablist = screen.getByRole('tablist')
    expect(tablist.className).toContain('w-full')
    expect(screen.getByRole('tab', { name: 'Docs' }).className).toContain('flex-1')
  })

  it('regression: the active tab is white with teal text and the segmented shadow, not a solid primary pill', () => {
    setup({ value: 'docs' })
    const active = screen.getByRole('tab', { name: 'Docs' }).className
    expect(active).toContain('bg-card')
    expect(active).toContain('text-primary-strong')
    expect(active).toContain('shadow-segmented')
    expect(active).toContain('rounded-[9px]')
    expect(active).toContain('leading-[normal]')
    expect(active).not.toContain('bg-primary ')
    expect(active).not.toContain('rounded-full')
    const track = screen.getByRole('tablist').className
    expect(track).toContain('bg-surface-segmented')
    expect(track).toContain('border-border-segmented')
    expect(track).toContain('rounded-[12px]')
  })
})

describe('Tabs keyboard pattern and ARIA wiring', () => {
  it('error: without idPrefix tabs have no id and no aria-controls', () => {
    setup()
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.getAttribute('aria-controls')).toBeNull()
      expect(tab.getAttribute('id')).toBeNull()
    }
  })

  it('edge: only the selected tab is tabbable', () => {
    setup({ value: 'tickets' })
    expect(screen.getByRole('tab', { name: 'Docs' }).getAttribute('tabindex')).toBe('-1')
    expect(screen.getByRole('tab', { name: 'Tickets' }).getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('tab', { name: 'Chat' }).getAttribute('tabindex')).toBe('-1')
  })

  it('edge: ArrowRight/ArrowLeft select the neighbour, wrap, and move focus', () => {
    const { onValueChange } = setup({ value: 'chat' })
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Chat' }), { key: 'ArrowRight' })
    expect(onValueChange).toHaveBeenLastCalledWith('docs')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Docs' }))
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Chat' }), { key: 'ArrowLeft' })
    expect(onValueChange).toHaveBeenLastCalledWith('tickets')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Tickets' }))
  })

  it('edge: Home and End jump to the first and last tab', () => {
    const { onValueChange } = setup({ value: 'tickets' })
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Tickets' }), { key: 'Home' })
    expect(onValueChange).toHaveBeenLastCalledWith('docs')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Docs' }))
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Tickets' }), { key: 'End' })
    expect(onValueChange).toHaveBeenLastCalledWith('chat')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Chat' }))
  })

  it('edge: idPrefix wires tab ids and aria-controls for consumer tabpanels', () => {
    setup({ idPrefix: 'po' })
    const tab = screen.getByRole('tab', { name: 'Tickets' })
    expect(tab.getAttribute('id')).toBe('po-tab-tickets')
    expect(tab.getAttribute('aria-controls')).toBe('po-panel-tickets')
  })

  it('regression: shortLabel keeps the full aria-label and clicking still selects', () => {
    const onValueChange = vi.fn()
    render(
      <Tabs
        items={[
          { id: 'docs', label: 'Purchase Orders', shortLabel: 'POs' },
          { id: 'tickets', label: 'Tickets' },
        ]}
        value="tickets"
        onValueChange={onValueChange}
        aria-label="Sections"
        idPrefix="x"
      />,
    )
    const tab = screen.getByRole('tab', { name: 'Purchase Orders' })
    expect(tab.getAttribute('aria-label')).toBe('Purchase Orders')
    fireEvent.click(tab)
    expect(onValueChange).toHaveBeenCalledWith('docs')
  })
})

describe('SegmentedControl', () => {
  const options = [
    { value: '', label: 'All' },
    { value: 'open', label: 'Open' },
    { value: 'dismissed', label: 'Dismissed' },
  ]

  function setupSegmented(overrides: Partial<React.ComponentProps<typeof SegmentedControl>> = {}) {
    const onValueChange = vi.fn()
    render(
      <SegmentedControl
        options={options}
        value="open"
        onValueChange={onValueChange}
        aria-label="Filter by status"
        {...overrides}
      />,
    )
    return { onValueChange }
  }

  it('edge: renders a labelled radiogroup whose options expose aria-checked', () => {
    setupSegmented()
    expect(screen.getByRole('radiogroup', { name: 'Filter by status' })).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'All' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('radio', { name: 'Open' }).getAttribute('aria-checked')).toBe('true')
  })

  it('edge: clicking the checked option does not call onValueChange', () => {
    const { onValueChange } = setupSegmented()
    fireEvent.click(screen.getByRole('radio', { name: 'Open' }))
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('edge: only the checked option is in the tab order', () => {
    setupSegmented()
    expect(screen.getByRole('radio', { name: 'Open' }).getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('radio', { name: 'All' }).getAttribute('tabindex')).toBe('-1')
    expect(screen.getByRole('radio', { name: 'Dismissed' }).getAttribute('tabindex')).toBe('-1')
  })

  it('edge: arrow keys move the selection and wrap around the ends', () => {
    const { onValueChange } = setupSegmented({ value: 'dismissed' })
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Dismissed' }), { key: 'ArrowRight' })
    expect(onValueChange).toHaveBeenLastCalledWith('')
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Dismissed' }), { key: 'ArrowLeft' })
    expect(onValueChange).toHaveBeenLastCalledWith('open')
  })

  it('edge: an unknown value leaves the first option tabbable', () => {
    setupSegmented({ value: 'missing' })
    expect(screen.getByRole('radio', { name: 'All' }).getAttribute('tabindex')).toBe('0')
    expect(screen.getAllByRole('radio').every((radio) => radio.getAttribute('aria-checked') === 'false')).toBe(true)
  })

  it('edge: size="sm" is the 2.11 compact control (track p3 r11, option 6px 12px r8 13px)', () => {
    setupSegmented({ size: 'sm' })
    const track = screen.getByRole('radiogroup').className
    expect(track).toContain('p-[3px]')
    expect(track).toContain('rounded-[11px]')
    expect(track).not.toContain('rounded-[12px]')
    const option = screen.getByRole('radio', { name: 'Open' }).className
    expect(option).toContain('px-3')
    expect(option).toContain('py-[6px]')
    expect(option).toContain('rounded-[8px]')
    expect(option).toContain('text-[13px]')
    expect(option).toContain('leading-[normal]')
    expect(option).not.toContain('rounded-[9px]')
    expect(option).not.toContain('text-[14px]')
  })

  it('regression: the checked option is white with teal text on the quiet track', () => {
    setupSegmented()
    const checked = screen.getByRole('radio', { name: 'Open' }).className
    expect(checked).toContain('leading-[normal]')
    expect(checked).toContain('bg-card')
    expect(checked).toContain('text-primary-strong')
    expect(checked).toContain('shadow-segmented')
    expect(checked).toContain('px-[14px]')
    expect(checked).toContain('py-[7px]')
    expect(screen.getByRole('radiogroup').className).toContain('bg-surface-segmented')
  })

  it('edge: fullWidth is a below-lg layout; at lg the md control returns (frames 4.2 vs 2.7)', () => {
    setupSegmented({ fullWidth: true })
    const group = screen.getByRole('radiogroup').className
    expect(group).toContain('lg:inline-flex')
    expect(group).toContain('lg:w-auto')
    expect(group).toContain('lg:p-1')
    const option = screen.getByRole('radio', { name: 'All' }).className
    expect(option).toContain('lg:flex-none')
    expect(option).toContain('lg:px-[14px]')
    expect(option).toContain('lg:py-[7px]')
  })

  it('happy: clicking another option reports its value and fullWidth stretches the options', () => {
    const { onValueChange } = setupSegmented({ fullWidth: true })
    fireEvent.click(screen.getByRole('radio', { name: 'Dismissed' }))
    expect(onValueChange).toHaveBeenCalledWith('dismissed')
    expect(screen.getByRole('radiogroup').className).toContain('w-full')
    expect(screen.getByRole('radio', { name: 'All' }).className).toContain('flex-1')
  })
})
