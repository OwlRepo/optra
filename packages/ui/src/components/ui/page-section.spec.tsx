/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Eyebrow, MicroLabel, PageSection } from './page-section'

afterEach(() => {
  cleanup()
})

function classesOf(element: Element | null) {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('PageSection, Eyebrow and MicroLabel', () => {
  it('edge: Eyebrow draws the 24px rule only when asked', () => {
    render(
      <>
        <Eyebrow rule>Tenant access</Eyebrow>
        <Eyebrow>Roster</Eyebrow>
      </>,
    )
    const rule = screen.getByText('Tenant access').querySelector('[data-eyebrow-rule]')
    expect(rule?.getAttribute('aria-hidden')).toBe('true')
    expect(classesOf(rule)).toEqual(expect.arrayContaining(['h-px', 'w-6', 'bg-current']))
    expect(screen.getByText('Roster').querySelector('[data-eyebrow-rule]')).toBeNull()
  })

  it('edge: Eyebrow and MicroLabel take their tones', () => {
    render(
      <>
        <Eyebrow tone="red">Confirm</Eyebrow>
        <Eyebrow tone="amber">Blocked</Eyebrow>
        <MicroLabel tone="teal">Page title</MicroLabel>
        <MicroLabel tone="amber">Needs a vendor first</MicroLabel>
        <MicroLabel tone="neutral">Owners & admins</MicroLabel>
        <MicroLabel tone="red">Failed</MicroLabel>
        <MicroLabel>Rows per page</MicroLabel>
      </>,
    )
    expect(classesOf(screen.getByText('Confirm'))).toContain('text-destructive-strong-text')
    expect(classesOf(screen.getByText('Blocked'))).toContain('text-flag-strong')
    expect(classesOf(screen.getByText('Page title'))).toContain('text-primary-strong')
    expect(classesOf(screen.getByText('Needs a vendor first'))).toContain('text-flag-strong')
    expect(classesOf(screen.getByText('Owners & admins'))).toContain('text-ink-neutral')
    expect(classesOf(screen.getByText('Failed'))).toContain('text-destructive-strong-text')
    expect(classesOf(screen.getByText('Rows per page'))).toEqual(
      expect.arrayContaining(['font-mono', 'text-[10px]', 'uppercase', 'tracking-[0.14em]', 'text-ink-muted', 'leading-[normal]']),
    )
    expect(classesOf(screen.getByText('Confirm'))).toContain('leading-[normal]')
  })

  it('edge: a caller className overrides the tone (cn merge, caller wins)', () => {
    render(
      <>
        <MicroLabel tone="teal" className="text-primary-strong-hover">
          All clear
        </MicroLabel>
        <Eyebrow className="text-ink-muted">Ghost</Eyebrow>
      </>,
    )
    const label = classesOf(screen.getByText('All clear'))
    expect(label).toContain('text-primary-strong-hover')
    expect(label).not.toContain('text-primary-strong')
    const eyebrow = classesOf(screen.getByText('Ghost'))
    expect(eyebrow).toContain('text-ink-muted')
    expect(eyebrow).not.toContain('text-primary-strong')
  })

  it('edge: MicroLabel renders as a span with a leading icon', () => {
    render(
      <MicroLabel as="span" icon={<svg data-testid="label-icon" />}>
        All clear
      </MicroLabel>,
    )
    const label = screen.getByText('All clear')
    expect(label.tagName).toBe('SPAN')
    expect(classesOf(label)).toEqual(expect.arrayContaining(['inline-flex', 'items-center', 'gap-2']))
    expect(label.firstElementChild).toBe(screen.getByTestId('label-icon'))
  })

  it('regression: a string title renders as the 28px section H2 under a Mono teal eyebrow', () => {
    render(<PageSection eyebrow="Roster" title="Members" />)
    expect(classesOf(screen.getByText('Roster'))).toEqual(
      expect.arrayContaining(['font-mono', 'text-[11px]', 'uppercase', 'tracking-[0.16em]', 'text-primary-strong']),
    )
    const heading = screen.getByRole('heading', { level: 2, name: 'Members' })
    expect(classesOf(heading)).toEqual(expect.arrayContaining(['text-[28px]', 'leading-[1.08]', 'mt-3']))
    expect(classesOf(heading)).not.toContain('md:text-4xl')
  })

  it('regression: the description is 15px body copy under the title', () => {
    render(<PageSection title="Members" description="Everyone with access to this workspace." />)
    expect(classesOf(screen.getByText('Everyone with access to this workspace.'))).toEqual(
      expect.arrayContaining(['mt-[10px]', 'text-[15px]', 'leading-[1.65]', 'text-ink-body']),
    )
  })

  it('edge: the header is not width-capped; a screen caps only its description (frame 3.3 Activity, 60ch)', () => {
    render(<PageSection title="Activity" description="What this workspace has done." descriptionClassName="max-w-[60ch]" />)
    const description = screen.getByText('What this workspace has done.')
    expect(classesOf(description)).toContain('max-w-[60ch]')
    expect(classesOf(description.parentElement).some((name) => name.startsWith('max-w-'))).toBe(false)
  })

  it('happy: actions render beside the header and children below it', () => {
    render(
      <PageSection title="Members" actions={<button type="button">Invite</button>}>
        <p>Roster table</p>
      </PageSection>,
    )
    expect(screen.getByRole('button', { name: 'Invite' })).toBeTruthy()
    expect(screen.getByText('Roster table')).toBeTruthy()
  })
})
