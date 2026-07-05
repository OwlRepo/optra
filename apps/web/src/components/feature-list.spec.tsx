/** @vitest-environment jsdom */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Zap } from 'lucide-react'
import { FeatureList, type FeatureListItem } from './feature-list'

const items: FeatureListItem[] = [
  { eyebrow: 'Efficiency', title: 'Reduce repeated interruptions', description: 'Self-serve answers', icon: Zap },
]

describe('FeatureList', () => {
  it('renders each item as a single row within one bordered panel, not separate cards', () => {
    const { container } = render(<FeatureList items={items} />)

    expect(screen.getByText('Reduce repeated interruptions')).not.toBeNull()
    expect(screen.getByText('Efficiency')).not.toBeNull()
    expect(screen.getByText('Self-serve answers')).not.toBeNull()

    const panels = container.querySelectorAll('.rounded-\\[2rem\\].border')
    expect(panels).toHaveLength(1)
  })
})
