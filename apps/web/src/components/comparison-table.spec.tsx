/** @vitest-environment jsdom */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ComparisonTable, type ComparisonRow } from './comparison-table'

const rows: ComparisonRow[] = [
  { before: 'Agents guess at the answer.', after: 'Agents cite the source.' },
]

describe('ComparisonTable', () => {
  it('renders the before/after column headers and each row pairing', () => {
    render(<ComparisonTable rows={rows} beforeLabel="Without Mnemra" afterLabel="With Mnemra" />)

    expect(screen.getByText('Without Mnemra')).not.toBeNull()
    expect(screen.getByText('With Mnemra')).not.toBeNull()
    expect(screen.getByText('Agents guess at the answer.')).not.toBeNull()
    expect(screen.getByText('Agents cite the source.')).not.toBeNull()
  })
})
