/** @vitest-environment jsdom */

import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Input } from './input'
import { Select } from './select'
import { Textarea } from './textarea'

afterEach(() => {
  cleanup()
})

function classesOf(element: Element | null) {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('Form fields', () => {
  it('edge: an invalid field turns its border red', () => {
    render(
      <>
        <Input aria-label="Member email" aria-invalid="true" />
        <Select aria-label="Vendor" aria-invalid="true">
          <option value="">Select</option>
        </Select>
        <Textarea aria-label="Decision note" aria-invalid="true" />
      </>,
    )
    expect(classesOf(screen.getByLabelText('Member email'))).toContain('aria-invalid:border-destructive-tone')
    expect(classesOf(screen.getByLabelText('Vendor'))).toContain('aria-invalid:border-destructive-tone')
    expect(classesOf(screen.getByLabelText('Decision note'))).toContain('aria-invalid:border-destructive-tone')
  })

  it('edge: Select stays a native select so ids, labels and option values keep working', () => {
    render(
      <>
        <label htmlFor="po-vendor">Vendor</label>
        <Select id="po-vendor" defaultValue="v2">
          <option value="v1">Ironclad Supply</option>
          <option value="v2">Northgate Packaging</option>
        </Select>
      </>,
    )
    const select = screen.getByLabelText('Vendor') as HTMLSelectElement
    expect(select.tagName).toBe('SELECT')
    expect(select.id).toBe('po-vendor')
    expect(select.value).toBe('v2')
  })

  it('edge: disabled fields sit on the subtle fill with muted ink', () => {
    render(<Input aria-label="Workspace name" disabled />)
    expect(classesOf(screen.getByLabelText('Workspace name'))).toEqual(
      expect.arrayContaining(['disabled:bg-surface-subtle', 'disabled:text-ink-muted', 'disabled:border-border-segmented']),
    )
  })

  it('regression: Input is a 42px, 12px-radius white well with a teal focus halo', () => {
    render(<Input aria-label="PO number" />)
    const classes = classesOf(screen.getByLabelText('PO number'))
    expect(classes).toEqual(
      expect.arrayContaining([
        'h-[42px]',
        'rounded-[12px]',
        'border-border-panel',
        'bg-card',
        'px-[14px]',
        'text-[15px]',
        'focus-visible:border-primary-strong',
        'focus-visible:shadow-focus',
      ]),
    )
    expect(classes).not.toContain('rounded-2xl')
    expect(classes.some((name) => name.includes('ring'))).toBe(false)
  })

  it('regression: Select drops native chrome and draws its own chevron', () => {
    render(
      <Select aria-label="Purchase order">
        <option value="">Select purchase order</option>
      </Select>,
    )
    expect(classesOf(screen.getByLabelText('Purchase order'))).toEqual(
      expect.arrayContaining(['appearance-none', 'select-chevron', 'h-[42px]', 'rounded-[12px]', 'pl-[14px]', 'pr-10']),
    )
  })

  it('regression: Textarea is at least 104px tall with 12px 14px padding', () => {
    render(<Textarea aria-label="Decision note" />)
    expect(classesOf(screen.getByLabelText('Decision note'))).toEqual(
      expect.arrayContaining(['min-h-[104px]', 'rounded-[12px]', 'px-[14px]', 'py-3', 'leading-[1.6]', 'resize-y']),
    )
  })

  it('happy: Input forwards its ref and value', () => {
    const ref = React.createRef<HTMLInputElement>()
    render(<Input ref={ref} aria-label="Currency" defaultValue="USD" />)
    expect(ref.current).toBe(screen.getByLabelText('Currency'))
    expect(ref.current?.value).toBe('USD')
  })
})
