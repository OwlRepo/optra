/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Pagination } from './pagination'

afterEach(() => {
  cleanup()
})

function setup(overrides: Partial<React.ComponentProps<typeof Pagination>> = {}) {
  const onPageChange = vi.fn()
  const onPageSizeChange = vi.fn()
  render(
    <Pagination
      page={2}
      pageSize={10}
      total={42}
      totalPages={5}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      {...overrides}
    />,
  )
  return { onPageChange, onPageSizeChange }
}

describe('Pagination', () => {
  it('shows the current range and total (X–Y of N)', () => {
    setup()
    expect(screen.getByText(/11.*20.*of.*42/)).toBeTruthy()
  })

  it('shows the current page and total pages', () => {
    setup()
    expect(screen.getByText(/Page 2 of 5/)).toBeTruthy()
  })

  it('goes to next and last page', () => {
    const { onPageChange } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPageChange).toHaveBeenCalledWith(3)
    fireEvent.click(screen.getByRole('button', { name: 'Last page' }))
    expect(onPageChange).toHaveBeenCalledWith(5)
  })

  it('goes to first and previous page', () => {
    const { onPageChange } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(onPageChange).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: 'First page' }))
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('disables first/prev on the first page', () => {
    setup({ page: 1 })
    expect(screen.getByRole('button', { name: 'First page' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Previous page' }).hasAttribute('disabled')).toBe(true)
  })

  it('disables next/last on the last page', () => {
    setup({ page: 5 })
    expect(screen.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Last page' }).hasAttribute('disabled')).toBe(true)
  })

  it('jumps to a specific page via the go-to input (clamped to totalPages)', () => {
    const { onPageChange } = setup()
    const input = screen.getByLabelText('Go to page') as HTMLInputElement
    fireEvent.change(input, { target: { value: '9' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect(onPageChange).toHaveBeenCalledWith(5)
  })

  it('changes page size', () => {
    const { onPageSizeChange } = setup()
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '20' } })
    expect(onPageSizeChange).toHaveBeenCalledWith(20)
  })

  it('reports an empty result set as 0 of 0 with all controls disabled', () => {
    setup({ page: 1, total: 0, totalPages: 0 })
    expect(screen.getByText(/0.*of.*0/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(true)
  })
})
