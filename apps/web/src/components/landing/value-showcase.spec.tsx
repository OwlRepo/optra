/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { UserPlus, Archive, Zap } from 'lucide-react'
import { afterEach, describe, expect, it } from 'vitest'
import { ValueShowcase } from './value-showcase'

afterEach(cleanup)

const items = [
  { eyebrow: 'Onboarding', title: 'Ramp new buyers faster', description: 'desc one', icon: UserPlus },
  { eyebrow: 'Continuity', title: 'Keep vendor history when people leave', description: 'desc two', icon: Archive },
  { eyebrow: 'Efficiency', title: 'Cut manual line-by-line review', description: 'desc three', icon: Zap },
]

describe('ValueShowcase', () => {
  it('renders all item titles', () => {
    render(<ValueShowcase items={items} />)
    for (const item of items) {
      expect(screen.getByText(item.title)).not.toBeNull()
    }
  })

  it('does not wrap icons in a colored-circle div', () => {
    const { container } = render(<ValueShowcase items={items} />)
    expect(container.querySelector('.rounded-2xl.bg-primary\\/10')).toBeNull()
  })

  it('renders icons directly with lucide classes', () => {
    const { container } = render(<ValueShowcase items={items} />)
    expect(container.querySelector('svg.lucide-user-plus')).not.toBeNull()
    expect(container.querySelector('svg.lucide-archive')).not.toBeNull()
    expect(container.querySelector('svg.lucide-zap')).not.toBeNull()
  })
})
