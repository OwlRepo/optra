/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppHeader } from './app-header'

afterEach(() => {
  cleanup()
})

describe('AppHeader', () => {
  it('renders logout control when onLogout is passed', () => {
    render(<AppHeader title="Workspace" onLogout={() => {}} />)

    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy()
  })

  it('calls onLogout once when logout control is clicked', () => {
    const onLogout = vi.fn()

    render(<AppHeader title="Workspace" onLogout={onLogout} />)

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('renders no logout control when onLogout is omitted', () => {
    render(<AppHeader title="Workspace" />)

    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull()
  })
})
