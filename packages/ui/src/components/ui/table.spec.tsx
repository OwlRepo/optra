/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table'

afterEach(() => {
  cleanup()
})

function classesOf(element: Element | null) {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

type Tone = 'teal' | 'amber' | 'red' | 'neutral'

function renderTable(options: { tone?: Tone; muted?: boolean } = {}) {
  return render(
    <Table header={<div>Uploaded purchase orders</div>} footer={<div>Page 1 of 1</div>}>
      <TableHeader>
        <TableRow>
          <TableHead>SKU</TableHead>
          <TableHead numeric>Delta</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow data-testid="body-row" tone={options.tone} muted={options.muted}>
          <TableCell>NG-KT48</TableCell>
          <TableCell numeric>+0.25</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  )
}

describe('Table', () => {
  it('edge: a toned row draws the 3px inset rule in its tone colour', () => {
    const expected: Record<Tone, string> = {
      teal: 'inset-shadow-[3px_0_0_var(--primary-strong)]',
      amber: 'inset-shadow-[3px_0_0_var(--flag)]',
      red: 'inset-shadow-[3px_0_0_var(--destructive-tone)]',
      neutral: 'inset-shadow-[3px_0_0_var(--border-dashed)]',
    }
    for (const tone of Object.keys(expected) as Tone[]) {
      renderTable({ tone })
      const row = screen.getByTestId('body-row')
      expect(classesOf(row)).toContain(expected[tone])
      expect(row.getAttribute('data-tone')).toBe(tone)
      cleanup()
    }
  })

  it('edge: an untoned row has no inset rule', () => {
    renderTable()
    const row = screen.getByTestId('body-row')
    expect(classesOf(row).some((name) => name.includes('inset-shadow'))).toBe(false)
    expect(row.hasAttribute('data-tone')).toBe(false)
  })

  it('edge: a muted row drops its ink to 60%', () => {
    renderTable({ muted: true })
    expect(classesOf(screen.getByTestId('body-row'))).toContain('text-foreground/60')
  })

  it('edge: numeric head and cell right-align, and the cell reads in Mono 13', () => {
    renderTable()
    expect(classesOf(screen.getByRole('columnheader', { name: 'Delta' }))).toContain('text-right')
    expect(classesOf(screen.getByRole('cell', { name: '+0.25' }))).toEqual(
      expect.arrayContaining(['text-right', 'font-mono', 'text-[13px]']),
    )
    expect(classesOf(screen.getByRole('cell', { name: 'NG-KT48' }))).not.toContain('font-mono')
  })

  it('regression: the table is the panel, one 18px hairline container around a horizontal scroller', () => {
    renderTable()
    const scroller = screen.getByRole('table').parentElement
    const panel = scroller?.parentElement ?? null
    expect(classesOf(scroller)).toContain('overflow-x-auto')
    expect(classesOf(panel)).toEqual(
      expect.arrayContaining(['rounded-[18px]', 'border', 'border-border-panel', 'bg-card', 'overflow-hidden']),
    )
    expect(classesOf(panel).some((name) => name.includes('shadow'))).toBe(false)
  })

  it('regression: header cells are 13px semibold body ink on the secondary fill', () => {
    renderTable()
    const head = screen.getByRole('columnheader', { name: 'SKU' })
    expect(classesOf(head.closest('thead'))).toContain('bg-secondary')
    expect(classesOf(head)).toEqual(
      expect.arrayContaining(['text-[13px]', 'font-semibold', 'text-ink-body', 'px-[14px]', 'py-3', 'first:pl-6']),
    )
  })

  it('regression: body rows use the inner rule and the subtle hover, cells 13px 14px', () => {
    renderTable()
    expect(classesOf(screen.getByTestId('body-row'))).toEqual(
      expect.arrayContaining(['border-t', 'border-border-inner', 'hover:bg-surface-hover']),
    )
    expect(classesOf(screen.getByRole('cell', { name: 'NG-KT48' }))).toEqual(
      expect.arrayContaining(['px-[14px]', 'py-[13px]', 'first:pl-6']),
    )
  })

  it('happy: header and footer slots sit inside the panel around the scroller', () => {
    renderTable()
    const panel = screen.getByRole('table').parentElement?.parentElement
    expect(panel?.firstElementChild?.textContent).toBe('Uploaded purchase orders')
    expect(panel?.lastElementChild?.textContent).toBe('Page 1 of 1')
  })
})
