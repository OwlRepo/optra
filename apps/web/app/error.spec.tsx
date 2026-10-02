/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GlobalError from './error'

function renderError() {
  // error.tsx renders its own <html><body>; React warns about the nesting
  // inside the test container, so console.error is silenced and observed.
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const reset = vi.fn()
  const error = Object.assign(new Error('boom'), { digest: 'digest-1' })
  render(<GlobalError error={error} reset={reset} />)
  return { consoleError, reset, error }
}

describe('GlobalError', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('error: logs the caught error once it renders', () => {
    const { consoleError, error } = renderError()

    expect(consoleError).toHaveBeenCalledWith(error)
  })

  it('regression: titles the page "Something broke on this page" under an "Unexpected error" eyebrow', () => {
    renderError()

    expect(screen.getByRole('heading', { level: 1, name: 'Something broke on this page' })).toBeTruthy()
    expect(screen.getByText('Unexpected error')).toBeTruthy()
  })

  it('regression: explains that nothing was saved half-way and drops the old copy', () => {
    renderError()

    expect(
      screen.getByText(
        'The error was caught and nothing was saved half-way. Try again, or go back home while we look into it.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText('Something broke in workspace')).toBeNull()
    expect(screen.queryByText(/Interface caught failure safely/)).toBeNull()
  })

  it('happy: Try again calls reset', () => {
    const { reset } = renderError()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('happy: Back to home links to /', () => {
    renderError()

    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/')
  })
})
