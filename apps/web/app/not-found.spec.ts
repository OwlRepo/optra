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

  // Frame 4.5 amber: "Open workspace" pointed at /chat (a redirect); it now
  // opens /workspaces and is the primary action.
  it('regression: "Open workspace" is the primary action and opens /workspaces, not /chat', () => {
    render(React.createElement(NotFound))

    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/workspaces', '/'])
    expect(screen.getByRole('link', { name: 'Open workspace' }).getAttribute('href')).toBe('/workspaces')
  })

  it('regression: renders the landing hero with the "404 · not found" rule eyebrow and an h1', () => {
    render(React.createElement(NotFound))

    expect(screen.getByText('404 · not found')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy()
    expect(screen.getByText('This page does not exist. Go home or open your workspace to continue.')).toBeTruthy()
  })

  it('happy: links home', () => {
    render(React.createElement(NotFound))

    expect(screen.getByRole('link', { name: 'Go home' }).getAttribute('href')).toBe('/')
  })
})
