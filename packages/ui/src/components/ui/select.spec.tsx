/** @vitest-environment jsdom */

import * as React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Select } from './select'

afterEach(() => {
  cleanup()
})

function currencyOptions() {
  return (
    <>
      <option value="USD">USD</option>
      <option value="PHP">PHP</option>
    </>
  )
}

describe('Select', () => {
  it('error: aria-invalid reaches the native select so the destructive border can apply', () => {
    render(
      <Select aria-label="Currency" aria-invalid="true">
        {currencyOptions()}
      </Select>,
    )
    const select = screen.getByRole('combobox', { name: 'Currency' })
    expect(select.getAttribute('aria-invalid')).toBe('true')
    expect(select.className).toContain('aria-invalid:border-destructive-tone')
  })

  it('edge: a disabled select is disabled natively and keeps the disabled styling hooks', () => {
    render(
      <Select aria-label="Currency" disabled>
        {currencyOptions()}
      </Select>,
    )
    const select = screen.getByRole('combobox', { name: 'Currency' }) as HTMLSelectElement
    expect(select.disabled).toBe(true)
    expect(select.className).toContain('disabled:cursor-not-allowed')
    expect(select.className).toContain('disabled:bg-surface-subtle')
  })

  it('edge: a caller height replaces the 42px default instead of stacking with it', () => {
    render(
      <Select aria-label="Currency" className="h-9">
        {currencyOptions()}
      </Select>,
    )
    const className = screen.getByRole('combobox', { name: 'Currency' }).className
    expect(className).toContain('h-9')
    expect(className).not.toContain('h-[42px]')
    expect(className).toContain('select-chevron')
  })

  it('happy: is a native select that reports the chosen value and forwards its ref', () => {
    const onChange = vi.fn()
    const ref = React.createRef<HTMLSelectElement>()
    render(
      <Select ref={ref} aria-label="Currency" defaultValue="USD" onChange={onChange}>
        {currencyOptions()}
      </Select>,
    )
    const select = screen.getByRole('combobox', { name: 'Currency' }) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'PHP' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(select.value).toBe('PHP')
    expect(select.tagName).toBe('SELECT')
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(ref.current).toBe(select)
  })
})
