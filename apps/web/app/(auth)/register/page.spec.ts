/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RegisterPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const registerMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
}))

vi.mock('@/lib/api/auth', () => ({
  register: (...args: unknown[]) => registerMock(...args),
}))

describe('RegisterPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    registerMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('registers and redirects to verify-otp with the entered email on success', async () => {
    registerMock.mockResolvedValue({ ok: true })

    const { container } = render(React.createElement(RegisterPage))

    expect(container.querySelector('[data-brand-mark="mnemra-bloom"]')).not.toBeNull()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }).closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith('new@example.com', 'password123')
      expect(pushMock).toHaveBeenCalledWith('/verify-otp?email=new%40example.com')
    })
  })

  it('shows a server error and does not redirect on failure', async () => {
    registerMock.mockRejectedValue({ message: 'Email already registered' })

    render(React.createElement(RegisterPage))

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }).closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(screen.getByText('Email already registered')).toBeDefined()
    })
    expect(pushMock).not.toHaveBeenCalled()
  })
})
