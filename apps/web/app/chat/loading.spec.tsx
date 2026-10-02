/** @vitest-environment jsdom */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ChatLoading from './loading'

describe('ChatLoading', () => {
  it('regression: renders the redirect panel instead of the assistant skeleton', () => {
    render(<ChatLoading />)

    expect(screen.getByText('Redirecting…')).toBeTruthy()
    expect(screen.getByText('Opening your workspace')).toBeTruthy()
    expect(screen.queryByText('Assistant workspace')).toBeNull()
    expect(screen.queryByText(/chat/i)).toBeNull()
  })

  it('happy: uses the Optra aperture brand mark in the header chrome', () => {
    const { container } = render(<ChatLoading />)

    expect(container.querySelector('[data-brand-mark="optra-mark"]')).not.toBeNull()
    expect(container.querySelector('svg.lucide-sparkles')).toBeNull()
  })
})
