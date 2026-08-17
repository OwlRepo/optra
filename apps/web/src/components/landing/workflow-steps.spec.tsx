/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkflowSteps } from './workflow-steps'

afterEach(cleanup)

describe('WorkflowSteps', () => {
  it('renders under the #workflow anchor the nav targets', () => {
    const { container } = render(<WorkflowSteps />)

    expect(container.querySelector('#workflow')).not.toBeNull()
    expect(
      screen.getByRole('heading', { name: 'From a folder of PDFs to a checked invoice' }),
    ).not.toBeNull()
  })

  it('walks through three numbered steps in order', () => {
    render(<WorkflowSteps />)

    expect(screen.getByText('1')).not.toBeNull()
    expect(screen.getByText('2')).not.toBeNull()
    expect(screen.getByText('3')).not.toBeNull()

    expect(screen.getByRole('heading', { name: 'Drop the files in' })).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Optra reads and matches' })).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'You review the exceptions' })).not.toBeNull()
  })

  it('shows accepted formats in the drop zone', () => {
    render(<WorkflowSteps />)

    expect(screen.getByText('pdf / xlsx / csv / jpg')).not.toBeNull()
  })

  it('renders the three extraction bars', () => {
    render(<WorkflowSteps />)

    for (const label of ['extract', 'catalog', 'photo']) {
      expect(screen.getByText(label)).not.toBeNull()
    }
  })

  // Step 3 is the exception-review step, so it is the one tinted amber rather
  // than teal -- the flag tone carries meaning here, not decoration.
  it('flags the review step with the exception count', () => {
    render(<WorkflowSteps />)

    expect(screen.getByText('2 of 14 lines flagged')).not.toBeNull()
    expect(screen.getByText('Line 3 · +18% price · Line 7 · item mismatch')).not.toBeNull()
  })
})
