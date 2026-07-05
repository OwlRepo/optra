/** @vitest-environment jsdom */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Stepper, type StepperStep } from './stepper'

const steps: StepperStep[] = [
  { step: '01', title: 'Add your knowledge', description: 'Upload docs' },
  { step: '02', title: 'Ask a question', description: 'Search the workspace' },
  { step: '03', title: 'Use the answer', description: 'Reply with confidence' },
]

describe('Stepper', () => {
  it('renders every step with its number, title, and description', () => {
    render(<Stepper steps={steps} />)

    steps.forEach((item) => {
      expect(screen.getByText(item.step)).not.toBeNull()
      expect(screen.getByText(item.title)).not.toBeNull()
      expect(screen.getByText(item.description)).not.toBeNull()
    })
  })

  it('does not draw a connector line after the final step', () => {
    const { container } = render(<Stepper steps={steps} />)

    const connectors = container.querySelectorAll('[aria-hidden="true"].bg-primary\\/30')
    expect(connectors).toHaveLength(steps.length - 1)
  })
})
