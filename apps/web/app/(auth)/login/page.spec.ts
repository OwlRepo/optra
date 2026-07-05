/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const loginMock = vi.fn()
const markLoggedInMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
}))

vi.mock('@/lib/api/auth', () => ({
  login: (...args: unknown[]) => loginMock(...args),
}))

vi.mock('@/lib/auth', () => ({
  markLoggedIn: (...args: unknown[]) => markLoggedInMock(...args),
}))

describe('LoginPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    loginMock.mockReset()
    markLoggedInMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('marks the session logged in and redirects to chat on success, without touching the raw token', async () => {
    loginMock.mockResolvedValue({ accessToken: 'jwt.value.here' })

    const { container } = render(React.createElement(LoginPage))

    expect(container.querySelector('[data-brand-mark="mnemra-bloom"]')).not.toBeNull()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('owner@example.com', 'password123')
      expect(markLoggedInMock).toHaveBeenCalledTimes(1)
      expect(markLoggedInMock).toHaveBeenCalledWith()
      expect(pushMock).toHaveBeenCalledWith('/chat')
    })
  })

  it('shows a server error and does not mark logged in on failure', async () => {
    loginMock.mockRejectedValue({ message: 'Invalid credentials' })

    render(React.createElement(LoginPage))

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeDefined()
    })
    expect(markLoggedInMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })
})
