/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Badge } from './badge'

afterEach(() => {
  cleanup()
})

function classesOf(element: Element | null) {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

const TEAL = ['border-primary-strong/30', 'bg-primary-strong/8', 'text-primary-strong-hover']
const AMBER = ['border-flag/40', 'bg-flag/10', 'text-flag-strong']
const RED = ['border-destructive-tone/35', 'bg-destructive-tone/8', 'text-destructive-strong-text']
const NEUTRAL = ['border-border-panel', 'bg-secondary', 'text-ink-neutral']
const CHIP = [
  'rounded-[7px]',
  'border-border-panel',
  'bg-surface-subtle',
  'font-mono',
  'text-[10px]',
  'uppercase',
  'tracking-[0.1em]',
  'text-ink-neutral',
]

describe('Badge', () => {
  it('edge: pulse marks the root with data-pulse and adds a 6px teal dot before the label, hidden from assistive tech', () => {
    render(
      <Badge variant="neutral" pulse>
        Processing
      </Badge>,
    )
    const badge = screen.getByText('Processing')
    expect(badge.getAttribute('data-pulse')).toBe('')
    const dot = badge.querySelector('[data-pulse-dot]')
    expect(dot).not.toBeNull()
    expect(dot?.getAttribute('aria-hidden')).toBe('true')
    expect(classesOf(dot)).toEqual(
      expect.arrayContaining(['size-[6px]', 'rounded-full', 'bg-primary-strong', 'animate-op-pulse']),
    )
    expect(badge.firstElementChild).toBe(dot)
  })

  it('edge: no dot and no data-pulse without pulse', () => {
    render(<Badge variant="neutral">Queued</Badge>)
    const badge = screen.getByText('Queued')
    expect(badge.hasAttribute('data-pulse')).toBe(false)
    expect(badge.querySelector('[data-pulse-dot]')).toBeNull()
  })

  it('regression: default and success render the teal tone', () => {
    render(
      <>
        <Badge>Ready</Badge>
        <Badge variant="success">On contract</Badge>
      </>,
    )
    expect(classesOf(screen.getByText('Ready'))).toEqual(expect.arrayContaining(TEAL))
    expect(classesOf(screen.getByText('On contract'))).toEqual(expect.arrayContaining(TEAL))
    expect(classesOf(screen.getByText('On contract')).some((name) => name.includes('emerald'))).toBe(false)
  })

  it('regression: warning renders the amber flag tone, not Tailwind amber', () => {
    render(<Badge variant="warning">Quantity mismatch</Badge>)
    const classes = classesOf(screen.getByText('Quantity mismatch'))
    expect(classes).toEqual(expect.arrayContaining(AMBER))
    expect(classes.some((name) => name.includes('amber-'))).toBe(false)
  })

  it('regression: destructive renders the red tone', () => {
    render(<Badge variant="destructive">Price mismatch</Badge>)
    expect(classesOf(screen.getByText('Price mismatch'))).toEqual(expect.arrayContaining(RED))
  })

  it('regression: secondary renders the neutral tone', () => {
    render(<Badge variant="secondary">Member</Badge>)
    expect(classesOf(screen.getByText('Member'))).toEqual(expect.arrayContaining(NEUTRAL))
  })

  it('regression: outline renders the Mono chip', () => {
    render(<Badge variant="outline">Upload</Badge>)
    const classes = classesOf(screen.getByText('Upload'))
    expect(classes).toEqual(expect.arrayContaining(CHIP))
    expect(classes).not.toContain('rounded-full')
  })

  it('regression: the pill is 12px semibold at 3px 10px and never wraps', () => {
    render(<Badge variant="teal">Owner</Badge>)
    expect(classesOf(screen.getByText('Owner'))).toEqual(
      expect.arrayContaining(['rounded-full', 'border', 'px-[10px]', 'py-[3px]', 'text-[12px]', 'font-semibold', 'whitespace-nowrap', 'gap-[6px]', 'leading-[normal]']),
    )
  })

  it('happy: the named tone variants match their legacy aliases', () => {
    render(
      <>
        <Badge variant="teal">Teal</Badge>
        <Badge variant="amber">Amber</Badge>
        <Badge variant="red">Red</Badge>
        <Badge variant="neutral">Neutral</Badge>
        <Badge variant="chip">Chip</Badge>
      </>,
    )
    expect(classesOf(screen.getByText('Teal'))).toEqual(expect.arrayContaining(TEAL))
    expect(classesOf(screen.getByText('Amber'))).toEqual(expect.arrayContaining(AMBER))
    expect(classesOf(screen.getByText('Red'))).toEqual(expect.arrayContaining(RED))
    expect(classesOf(screen.getByText('Neutral'))).toEqual(expect.arrayContaining(NEUTRAL))
    expect(classesOf(screen.getByText('Chip'))).toEqual(expect.arrayContaining([...CHIP, 'leading-[normal]']))
  })

  it('happy: solid verdicts are white uppercase 11px on the tone fill', () => {
    render(
      <>
        <Badge variant="solid-teal">Match</Badge>
        <Badge variant="solid-amber">Flagged</Badge>
        <Badge variant="solid-red">No match</Badge>
      </>,
    )
    const solid = ['text-white', 'uppercase', 'text-[11px]', 'tracking-[0.06em]', 'px-[11px]', 'py-[5px]', 'border-0', 'leading-[normal]']
    expect(classesOf(screen.getByText('Match'))).toEqual(expect.arrayContaining([...solid, 'bg-primary-strong']))
    expect(classesOf(screen.getByText('Flagged'))).toEqual(expect.arrayContaining([...solid, 'bg-flag']))
    expect(classesOf(screen.getByText('No match'))).toEqual(expect.arrayContaining([...solid, 'bg-destructive-tone']))
  })

  it('happy: the root stays a div and forwards props', () => {
    render(
      <Badge variant="teal" data-testid="role-badge" title="Workspace role">
        Admin
      </Badge>,
    )
    const badge = screen.getByTestId('role-badge')
    expect(badge.tagName).toBe('DIV')
    expect(badge.getAttribute('title')).toBe('Workspace role')
  })
})
