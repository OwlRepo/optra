/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { Search, Workflow, ShieldCheck } from 'lucide-react'
import { afterEach, describe, expect, it } from 'vitest'
import { PillarShowcase } from './pillar-showcase'

afterEach(cleanup)

const pillars = [
  { icon: Search, title: 'Match it once, not line by line', description: 'desc one' },
  { icon: Workflow, title: 'Learn from every past order', description: 'desc two' },
  { icon: ShieldCheck, title: 'Approve with evidence, not a guess', description: 'desc three' },
]

describe('PillarShowcase', () => {
  it('renders all pillar titles', () => {
    render(<PillarShowcase pillars={pillars} />)
    for (const pillar of pillars) {
      expect(screen.getByText(pillar.title)).not.toBeNull()
    }
  })

  it('keeps the flagship pillar icon at size-5 with lucide-search class', () => {
    const { container } = render(<PillarShowcase pillars={pillars} />)
    expect(container.querySelector('svg.lucide-search.size-5')).not.toBeNull()
  })

  it('does not wrap icons in a colored-circle div', () => {
    const { container } = render(<PillarShowcase pillars={pillars} />)
    expect(container.querySelector('.rounded-2xl.bg-primary\\/10')).toBeNull()
  })

  it('embeds a PhotoCompare artifact in the flagship card', () => {
    render(<PillarShowcase pillars={pillars} />)
    expect(screen.getByTestId('photo-compare-query-panel')).not.toBeNull()
    expect(screen.getByTestId('photo-compare-candidate-panel')).not.toBeNull()
  })
})
