/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Card, CardTitle, PanelHeader } from './card'

afterEach(() => {
  cleanup()
})

function classesOf(element: Element | null) {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('Card', () => {
  it('edge: PanelHeader renders an h2 by default and an h3 when titleAs="h3"', () => {
    render(
      <>
        <PanelHeader title="Uploaded purchase orders" />
        <PanelHeader title="Run a comparison" titleAs="h3" />
      </>,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Uploaded purchase orders' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Run a comparison' })).toBeTruthy()
  })

  it('edge: PanelHeader renders only the title when nothing else is passed', () => {
    const { container } = render(<PanelHeader title="Members" />)
    expect(container.querySelectorAll('p')).toHaveLength(0)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('regression: default, elevated, gradient and panel render the hairline panel with no shadow, blur or gradient', () => {
    const variants = ['default', 'elevated', 'gradient', 'panel'] as const
    for (const variant of variants) {
      render(<Card variant={variant} data-testid={`card-${variant}`} />)
      const classes = classesOf(screen.getByTestId(`card-${variant}`))
      expect(classes).toEqual(expect.arrayContaining(['rounded-[18px]', 'border', 'border-border-panel', 'bg-card']))
      expect(classes.some((name) => name.includes('shadow'))).toBe(false)
      expect(classes.some((name) => name.includes('backdrop-blur'))).toBe(false)
      expect(classes.some((name) => name.includes('gradient'))).toBe(false)
    }
  })

  it('regression: subtle and inset render the subtle inset fill', () => {
    render(
      <>
        <Card variant="subtle" data-testid="card-subtle" />
        <Card variant="inset" data-testid="card-inset" />
      </>,
    )
    for (const id of ['card-subtle', 'card-inset']) {
      const classes = classesOf(screen.getByTestId(id))
      expect(classes).toEqual(expect.arrayContaining(['rounded-[18px]', 'border-border-panel', 'bg-surface-subtle']))
      expect(classes.some((name) => name.includes('backdrop-blur'))).toBe(false)
    }
  })

  it('regression: CardTitle is a 20px Outfit heading at 600 and -0.035em', () => {
    render(<CardTitle>Workspace name</CardTitle>)
    expect(classesOf(screen.getByText('Workspace name'))).toEqual(
      expect.arrayContaining(['font-display', 'text-[20px]', 'font-semibold', 'tracking-[-0.035em]']),
    )
  })

  it('happy: PanelHeader shows eyebrow, title, description and action over an inner rule', () => {
    const { container } = render(
      <PanelHeader
        eyebrow="Compare"
        title="Run a comparison"
        description="Pick a parsed purchase order and invoice to check for discrepancies."
        action={<button type="button">Upload purchase order</button>}
      />,
    )
    const root = container.firstElementChild
    expect(classesOf(root)).toEqual(
      expect.arrayContaining(['border-b', 'border-border-inner', 'px-6', 'py-[22px]', 'justify-between', 'items-end']),
    )
    expect(classesOf(screen.getByText('Compare'))).toEqual(
      expect.arrayContaining(['font-mono', 'text-[11px]', 'uppercase', 'tracking-[0.16em]', 'text-primary-strong']),
    )
    expect(classesOf(screen.getByRole('heading', { name: 'Run a comparison' }))).toEqual(
      expect.arrayContaining(['text-[22px]', 'mt-[10px]', 'leading-[normal]']),
    )
    expect(classesOf(screen.getByText('Pick a parsed purchase order and invoice to check for discrepancies.'))).toEqual(
      expect.arrayContaining(['mt-2', 'text-[14px]', 'text-ink-body']),
    )
    expect(screen.getByRole('button', { name: 'Upload purchase order' })).toBeTruthy()
  })
})
