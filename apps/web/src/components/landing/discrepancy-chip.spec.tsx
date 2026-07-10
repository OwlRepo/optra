/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DiscrepancyChip } from './discrepancy-chip'

describe('DiscrepancyChip', () => {
  it('renders its children', () => {
    render(
      <DiscrepancyChip>
        <span>Flagged</span>
      </DiscrepancyChip>,
    )
    expect(screen.getByText('Flagged')).not.toBeNull()
  })
})
