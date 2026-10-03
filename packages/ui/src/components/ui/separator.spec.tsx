/** @vitest-environment jsdom */

import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Separator } from './separator'

afterEach(() => {
  cleanup()
})

describe('Separator', () => {
  it('edge: vertical orientation draws a full-height 1px rule', () => {
    render(<Separator data-testid="rule" orientation="vertical" />)
    const className = screen.getByTestId('rule').className
    expect(className).toContain('h-full')
    expect(className).toContain('w-[1px]')
    expect(className).not.toContain('h-[1px]')
  })

  it('edge: orientation is consumed, not leaked onto the DOM', () => {
    render(<Separator data-testid="rule" orientation="vertical" />)
    expect(screen.getByTestId('rule').hasAttribute('orientation')).toBe(false)
  })

  it('happy: defaults to a horizontal full-width rule and passes props and ref through', () => {
    const ref = React.createRef<HTMLDivElement>()
    render(<Separator ref={ref} data-testid="rule" aria-hidden="true" className="my-4" />)
    const rule = screen.getByTestId('rule')
    expect(rule.className).toContain('h-[1px]')
    expect(rule.className).toContain('w-full')
    expect(rule.className).toContain('bg-border')
    expect(rule.className).toContain('my-4')
    expect(rule.getAttribute('aria-hidden')).toBe('true')
    expect(ref.current).toBe(rule)
  })
})
