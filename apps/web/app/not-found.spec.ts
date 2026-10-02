/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import NotFound from './not-found'

describe('NotFound', () => {
  afterEach(() => {
    cleanup()
  })

  it('regression: offers no assistant link or copy while support surfaces are hidden', () => {
    render(React.createElement(NotFound))

    expect(screen.queryByRole('link', { name: /assistant/i })).toBeNull()
    expect(screen.queryByText(/assistant/i)).toBeNull()
  })

  it('happy: links home and to the workspace landing hub', () => {
    render(React.createElement(NotFound))

    expect(screen.getByRole('link', { name: 'Go home' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: 'Open workspace' }).getAttribute('href')).toBe('/chat')
  })
})
