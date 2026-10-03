/** @vitest-environment jsdom */

import * as React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Textarea } from './textarea'

afterEach(() => {
  cleanup()
})

describe('Textarea', () => {
  it('error: aria-invalid reaches the textarea so the destructive border can apply', () => {
    render(<Textarea aria-label="Dispute note" aria-invalid="true" />)
    const field = screen.getByRole('textbox', { name: 'Dispute note' })
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.className).toContain('aria-invalid:border-destructive-tone')
  })

  it('edge: a disabled textarea is disabled natively and keeps the disabled styling hooks', () => {
    render(<Textarea aria-label="Dispute note" disabled />)
    const field = screen.getByRole('textbox', { name: 'Dispute note' }) as HTMLTextAreaElement
    expect(field.disabled).toBe(true)
    expect(field.className).toContain('disabled:cursor-not-allowed')
    expect(field.className).toContain('disabled:bg-surface-subtle')
  })

  it('edge: a caller min-height replaces the 104px default instead of stacking with it', () => {
    render(<Textarea aria-label="Dispute note" className="min-h-[60px]" />)
    const className = screen.getByRole('textbox', { name: 'Dispute note' }).className
    expect(className).toContain('min-h-[60px]')
    expect(className).not.toContain('min-h-[104px]')
  })

  it('happy: reports typed text, shows its placeholder and forwards its ref', () => {
    const onChange = vi.fn()
    const ref = React.createRef<HTMLTextAreaElement>()
    render(
      <Textarea ref={ref} aria-label="Dispute note" placeholder="Why is this line wrong?" onChange={onChange} />,
    )
    const field = screen.getByPlaceholderText('Why is this line wrong?') as HTMLTextAreaElement
    fireEvent.change(field, { target: { value: 'Billed 24 rolls, ordered 18' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(field.value).toBe('Billed 24 rolls, ordered 18')
    expect(field.tagName).toBe('TEXTAREA')
    expect(ref.current).toBe(field)
  })
})
