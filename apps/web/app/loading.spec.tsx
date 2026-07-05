/** @vitest-environment jsdom */

import React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import RootLoading from './loading'

describe('RootLoading', () => {
  it('uses the Mnemra bloom brand mark in the header chrome', () => {
    const { container } = render(<RootLoading />)

    expect(container.querySelector('[data-brand-mark="mnemra-bloom"]')).not.toBeNull()
    expect(container.querySelector('svg.lucide-sparkles')).toBeNull()
  })
})
