/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { HistoryRow, type HistoryRowTone } from './history-row'

afterEach(() => {
  cleanup()
})

function classesOf(element: Element | null) {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('HistoryRow', () => {
  it('edge: each tone draws its 2px left rule and colours the event key', () => {
    const expected: Record<HistoryRowTone, [string, string]> = {
      teal: ['border-l-primary-strong', 'text-primary-strong-hover'],
      amber: ['border-l-flag', 'text-flag-strong'],
      red: ['border-l-destructive-tone', 'text-destructive-strong-text'],
      neutral: ['border-l-border-dashed', 'text-ink-muted'],
    }
    for (const tone of Object.keys(expected) as HistoryRowTone[]) {
      const { container } = render(
        <HistoryRow eventKey={`key_${tone}`} title="Event" timestamp="2026-10-02 09:14" tone={tone} />,
      )
      const row = container.firstElementChild
      expect(classesOf(row)).toEqual(expect.arrayContaining(['border-l-2', expected[tone][0]]))
      expect(row?.getAttribute('data-tone')).toBe(tone)
      expect(classesOf(screen.getByText(`key_${tone}`))).toEqual(
        expect.arrayContaining(['font-mono', 'text-[11px]', expected[tone][1]]),
      )
      cleanup()
    }
  })

  it('edge: an unseen row gets the teal /0.06 tint whatever its tone, and the rounded right edge (frame 3.3)', () => {
    const { container } = render(
      <HistoryRow eventKey="comparison_flagged" title="PO-2026-1180 ↔ INV-44120" timestamp="2026-10-02 09:14" tone="amber" unseen />,
    )
    const row = container.firstElementChild
    expect(classesOf(row)).toEqual(expect.arrayContaining(['rounded-r-[10px]', 'bg-primary-strong/6', 'border-l-flag']))
    expect(classesOf(row)).not.toContain('bg-flag/7')
    expect(row?.getAttribute('data-unseen')).toBe('true')
  })

  it('edge: a seen row has no tint and no rounded edge', () => {
    const { container } = render(
      <HistoryRow eventKey="scrape_completed" title="Ironclad catalog crawl finished" timestamp="2026-10-01 17:40" tone="teal" />,
    )
    const classes = classesOf(container.firstElementChild)
    expect(classes).not.toContain('rounded-r-[10px]')
    expect(classes).not.toContain('bg-primary-strong/6')
    expect(container.firstElementChild?.hasAttribute('data-unseen')).toBe(false)
  })

  it('edge: detail is optional and renders as a 13px second line', () => {
    render(
      <HistoryRow
        eventKey="document_failed"
        title="ironclad-q1.pdf could not be read"
        detail="Could not read a line-item table on pages 1–3."
        timestamp="2026-09-21 16:02"
        tone="red"
      />,
    )
    expect(classesOf(screen.getByText('Could not read a line-item table on pages 1–3.'))).toEqual(
      expect.arrayContaining(['block', 'text-[13px]']),
    )
  })

  it('happy: renders the event key, 14/500 title and Mono timestamp in a 170px | 1fr | auto grid (frame 3.3)', () => {
    const { container } = render(
      <HistoryRow eventKey="document_ingested" title="po-8791.pdf parsed — 14 rows" timestamp="2026-09-30 15:26" tone="neutral" />,
    )
    expect(classesOf(container.firstElementChild)).toEqual(
      expect.arrayContaining(['grid', 'grid-cols-[170px_minmax(0,1fr)_auto]', 'gap-4', 'px-[14px]', 'py-[10px]', 'items-baseline']),
    )
    expect(classesOf(screen.getByText('po-8791.pdf parsed — 14 rows'))).toEqual(
      expect.arrayContaining(['block', 'text-[14px]', 'font-medium']),
    )
    expect(classesOf(screen.getByText('2026-09-30 15:26'))).toEqual(
      expect.arrayContaining(['font-mono', 'text-[11px]', 'text-ink-muted', 'whitespace-nowrap']),
    )
  })
})
