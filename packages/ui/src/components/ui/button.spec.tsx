/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Button } from './button'

afterEach(() => {
  cleanup()
})

function classesOf(element: Element | null) {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('Button', () => {
  it('edge: isLoading disables the button, marks it busy and swaps in loadingText', () => {
    render(
      <Button isLoading loadingText="Comparing">
        Run comparison
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Comparing' })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByText('Run comparison')).toBeNull()
  })

  it('edge: the loading spinner turns at 0.9s linear', () => {
    render(<Button isLoading>Save</Button>)
    const spinner = screen.getByRole('button').querySelector('svg')
    expect(classesOf(spinner)).toContain('animate-[spin_0.9s_linear_infinite]')
  })

  it('edge: asChild hands the primary look to the child element', () => {
    render(
      <Button asChild>
        <a href="/workspaces">Open workspace</a>
      </Button>,
    )
    expect(classesOf(screen.getByRole('link', { name: 'Open workspace' }))).toContain('bg-primary-strong')
  })

  it('regression: default button fills with primary-strong, no shadow, no active scale', () => {
    render(<Button>Run comparison</Button>)
    const classes = classesOf(screen.getByRole('button', { name: 'Run comparison' }))
    expect(classes).toEqual(
      expect.arrayContaining([
        'bg-primary-strong',
        'hover:bg-primary-strong-hover',
        'h-[42px]',
        'px-[18px]',
        'rounded-[12px]',
        'text-[15px]',
        'font-medium',
        'leading-[normal]',
      ]),
    )
    expect(classes.some((name) => name.includes('shadow'))).toBe(false)
    expect(classes.some((name) => name.includes('active:scale'))).toBe(false)
    expect(classes).not.toContain('bg-primary')
  })

  it('regression: focus is a 2px primary-strong outline at a 2px offset, not a ring', () => {
    render(<Button>Focus me</Button>)
    const classes = classesOf(screen.getByRole('button', { name: 'Focus me' }))
    expect(classes).toEqual(
      expect.arrayContaining([
        'focus-visible:outline-2',
        'focus-visible:outline-offset-2',
        'focus-visible:outline-primary-strong',
      ]),
    )
    expect(classes.some((name) => name.includes('ring'))).toBe(false)
  })

  it('regression: outline renders the white hairline secondary that warms to teal on hover', () => {
    render(<Button variant="outline">Scrape website</Button>)
    const classes = classesOf(screen.getByRole('button', { name: 'Scrape website' }))
    expect(classes).toEqual(
      expect.arrayContaining(['border', 'border-border-panel', 'bg-card', 'text-foreground', 'hover:border-primary-strong/50']),
    )
  })

  it('regression: secondary renders the tonal fill', () => {
    render(<Button variant="secondary">Tonal</Button>)
    const classes = classesOf(screen.getByRole('button', { name: 'Tonal' }))
    expect(classes).toEqual(expect.arrayContaining(['bg-secondary', 'text-foreground', 'hover:bg-secondary-hover']))
  })

  it('regression: ghost renders ink-ghost text with a 14px inset at the default size', () => {
    render(<Button variant="ghost">Cancel</Button>)
    const classes = classesOf(screen.getByRole('button', { name: 'Cancel' }))
    expect(classes).toEqual(
      expect.arrayContaining(['text-ink-ghost', 'hover:bg-secondary', 'hover:text-foreground', 'px-[14px]']),
    )
    expect(classes).not.toContain('px-[18px]')
  })

  it('regression: destructive fills with destructive-strong', () => {
    render(<Button variant="destructive">Remove member</Button>)
    const classes = classesOf(screen.getByRole('button', { name: 'Remove member' }))
    expect(classes).toEqual(
      expect.arrayContaining(['bg-destructive-strong', 'text-white', 'hover:bg-destructive-strong-text']),
    )
  })

  it('regression: accent is retired into the primary look', () => {
    render(<Button variant="accent">Accent</Button>)
    const classes = classesOf(screen.getByRole('button', { name: 'Accent' }))
    expect(classes).toContain('bg-primary-strong')
    expect(classes).not.toContain('bg-accent')
  })

  it('regression: sm is 36px with a 10px radius and 14px type', () => {
    render(<Button size="sm">Upload purchase order</Button>)
    const classes = classesOf(screen.getByRole('button', { name: 'Upload purchase order' }))
    expect(classes).toEqual(expect.arrayContaining(['h-9', 'rounded-[10px]', 'px-[14px]', 'text-[14px]', 'leading-[normal]']))
  })

  it('regression: lg is 52px with a 14px radius and the CTA shadow', () => {
    render(<Button size="lg">Join workspace</Button>)
    const classes = classesOf(screen.getByRole('button', { name: 'Join workspace' }))
    expect(classes).toEqual(
      expect.arrayContaining(['h-[52px]', 'rounded-[14px]', 'px-[26px]', 'text-[16px]', 'shadow-cta']),
    )
  })

  it('regression: icon is a 36px square with a 10px radius', () => {
    render(
      <Button size="icon" variant="ghost" aria-label="Download">
        <svg />
      </Button>,
    )
    const classes = classesOf(screen.getByRole('button', { name: 'Download' }))
    expect(classes).toEqual(expect.arrayContaining(['size-9', 'rounded-[10px]', 'hover:text-primary-strong']))
  })

  it('regression: link drops the fixed height and padding and underlines at a 4px offset', () => {
    render(<Button variant="link">Go to vendors</Button>)
    const classes = classesOf(screen.getByRole('button', { name: 'Go to vendors' }))
    expect(classes).toEqual(
      expect.arrayContaining(['h-auto', 'p-0', 'underline', 'underline-offset-4', 'decoration-primary-strong/40']),
    )
    expect(classes).not.toContain('h-[42px]')
  })

  it('happy: xs is the 32px table-row action size', () => {
    render(
      <Button size="xs" variant="outline">
        Review
      </Button>,
    )
    const classes = classesOf(screen.getByRole('button', { name: 'Review' }))
    expect(classes).toEqual(expect.arrayContaining(['h-8', 'rounded-[9px]', 'px-3', 'text-[13px]']))
  })

  it('happy: disabled dims to 45% and loading holds at 85%', () => {
    render(<Button disabled>Disabled</Button>)
    const classes = classesOf(screen.getByRole('button', { name: 'Disabled' }))
    expect(classes).toEqual(expect.arrayContaining(['disabled:opacity-45', 'aria-busy:opacity-85']))
  })
})
