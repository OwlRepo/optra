/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Switch } from './switch'

afterEach(() => {
  cleanup()
})

function classesOf(element: Element | null) {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('Switch', () => {
  it('error: a disabled switch ignores clicks', () => {
    const onCheckedChange = vi.fn()
    render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Email digest" disabled />)
    fireEvent.click(screen.getByRole('switch', { name: 'Email digest' }))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('edge: clicking an off switch asks for on, and an on switch asks for off', () => {
    const onCheckedChange = vi.fn()
    const { rerender } = render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Email digest" />)
    fireEvent.click(screen.getByRole('switch', { name: 'Email digest' }))
    expect(onCheckedChange).toHaveBeenLastCalledWith(true)
    rerender(<Switch checked onCheckedChange={onCheckedChange} aria-label="Email digest" />)
    fireEvent.click(screen.getByRole('switch', { name: 'Email digest' }))
    expect(onCheckedChange).toHaveBeenLastCalledWith(false)
  })

  it('edge: aria-checked mirrors the checked prop', () => {
    const { rerender } = render(<Switch checked={false} onCheckedChange={() => {}} aria-label="Email digest" />)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
    rerender(<Switch checked onCheckedChange={() => {}} aria-label="Email digest" />)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })

  it('regression: the on track is the 44×26 teal pill with a 20px white knob at the right', () => {
    render(<Switch checked onCheckedChange={() => {}} aria-label="Email digest" />)
    const track = screen.getByRole('switch')
    expect(classesOf(track)).toEqual(expect.arrayContaining(['w-11', 'h-[26px]', 'rounded-full', 'bg-primary-strong']))
    const knob = track.firstElementChild
    expect(knob?.getAttribute('aria-hidden')).toBe('true')
    expect(classesOf(knob)).toEqual(
      expect.arrayContaining(['size-5', 'top-[3px]', 'left-[21px]', 'bg-card', 'rounded-full', 'shadow-knob']),
    )
  })

  it('edge: the off track is ink-muted grey (WCAG 1.4.11, >=3:1) with the knob at the left', () => {
    render(<Switch checked={false} onCheckedChange={() => {}} aria-label="Email digest" />)
    const track = screen.getByRole('switch')
    expect(classesOf(track)).toContain('bg-ink-muted')
    expect(classesOf(track)).not.toContain('bg-border-dashed')
    expect(classesOf(track)).not.toContain('bg-primary-strong')
    expect(classesOf(track.firstElementChild)).toEqual(expect.arrayContaining(['left-[3px]', 'shadow-knob']))
  })

  it('happy: forwards id, aria-labelledby and type="button"', () => {
    render(
      <>
        <span id="digest-label">Email digest</span>
        <Switch id="digest" checked={false} onCheckedChange={() => {}} aria-labelledby="digest-label" />
      </>,
    )
    const track = screen.getByRole('switch', { name: 'Email digest' })
    expect(track.getAttribute('id')).toBe('digest')
    expect(track.getAttribute('type')).toBe('button')
    const knob = track.firstElementChild
    expect(classesOf(knob)).toContain('left-[3px]')
  })
})
