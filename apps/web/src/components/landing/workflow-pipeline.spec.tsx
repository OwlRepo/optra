/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkflowPipeline } from './workflow-pipeline'

afterEach(cleanup)

const steps = [
  { title: 'Connect your vendors', description: 'Upload vendor catalogs, purchase orders, and invoices.' },
  { title: 'Optra matches automatically', description: 'Optra reads each line item and matches it.' },
  { title: 'Review what got flagged', description: 'Get a clear result for every line.' },
]

describe('WorkflowPipeline', () => {
  it('renders all step titles and descriptions', () => {
    render(<WorkflowPipeline steps={steps} />)
    for (const step of steps) {
      expect(screen.getByText(step.title)).not.toBeNull()
      expect(screen.getByText(step.description)).not.toBeNull()
    }
  })

  it('renders no numbered step badges (01/02/03)', () => {
    render(<WorkflowPipeline steps={steps} />)
    expect(screen.queryByText('01')).toBeNull()
    expect(screen.queryByText('02')).toBeNull()
    expect(screen.queryByText('03')).toBeNull()
  })

  it('renders a confidence meter on the match step', () => {
    render(<WorkflowPipeline steps={steps} />)
    expect(screen.getByRole('progressbar')).not.toBeNull()
  })

  it('renders a Flagged badge on the review step', () => {
    render(<WorkflowPipeline steps={steps} />)
    expect(screen.getByText('Flagged')).not.toBeNull()
  })
})
