/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScopeChip } from './scope-chip'

function renderChip(props: Partial<React.ComponentProps<typeof ScopeChip>> = {}) {
  const onClear = vi.fn()
  render(
    React.createElement(ScopeChip, {
      label: 'PO-2026-1180 ↔ INV-44120',
      clearLabel: 'Clear pair filter',
      onClear,
      ...props,
    }),
  )
  return { onClear }
}

describe('ScopeChip', () => {
  afterEach(() => {
    cleanup()
  })

  it('edge: the clear control is a button named by clearLabel, not by its × glyph', () => {
    renderChip({ clearLabel: 'Clear line scope' })

    expect(screen.getByRole('button', { name: 'Clear line scope' })).toBeDefined()
    expect(screen.queryByRole('button', { name: '×' })).toBeNull()
  })

  it('edge: renders the label verbatim, placeholders included', () => {
    renderChip({ label: '— ↔ inv-9' })

    expect(screen.getByText('— ↔ inv-9')).toBeDefined()
  })

  it('happy: × calls onClear once', () => {
    const { onClear } = renderChip()

    fireEvent.click(screen.getByRole('button', { name: 'Clear pair filter' }))

    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
