/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VerifyOtpPage from './page'

const pushMock = vi.fn()
const refreshMock = vi.fn()
const routerMock = { push: pushMock, refresh: refreshMock }
const searchParamsMock = { get: vi.fn().mockReturnValue('owner@example.com') }
const verifyOtpMock = vi.fn()
const resendOtpMock = vi.fn()
const markLoggedInMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  useSearchParams: () => searchParamsMock,
}))

vi.mock('@/lib/api/auth', () => ({
  verifyOtp: (...args: unknown[]) => verifyOtpMock(...args),
  resendOtp: (...args: unknown[]) => resendOtpMock(...args),
}))

vi.mock('@/lib/auth', () => ({
  markLoggedIn: (...args: unknown[]) => markLoggedInMock(...args),
}))

describe('VerifyOtpPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    refreshMock.mockReset()
    verifyOtpMock.mockReset()
    resendOtpMock.mockReset()
    markLoggedInMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('marks the session logged in and redirects to chat on success, without touching the raw token', async () => {
    verifyOtpMock.mockResolvedValue({ accessToken: 'jwt.value.here' })

    const { container } = render(React.createElement(VerifyOtpPage))

    expect(container.querySelector('[data-brand-mark="optra-mark"]')).not.toBeNull()

    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Verify email' }).closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(verifyOtpMock).toHaveBeenCalledWith('owner@example.com', '123456')
      expect(markLoggedInMock).toHaveBeenCalledTimes(1)
      expect(markLoggedInMock).toHaveBeenCalledWith()
      expect(refreshMock).toHaveBeenCalledTimes(1)
      expect(pushMock).toHaveBeenCalledWith('/chat')
    })
  })

  it('shows a server error and does not mark logged in on failure', async () => {
    verifyOtpMock.mockRejectedValue({ message: 'Invalid code' })

    render(React.createElement(VerifyOtpPage))

    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '000000' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Verify email' }).closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(screen.getByText('Invalid code')).toBeDefined()
    })
    expect(markLoggedInMock).not.toHaveBeenCalled()
    expect(refreshMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('error: a failed resend shows the error', async () => {
    resendOtpMock.mockRejectedValue({ message: 'Too many requests. Please wait a few minutes and try again.' })

    render(React.createElement(VerifyOtpPage))
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }))

    await waitFor(() => {
      expect(screen.getByText('Too many requests. Please wait a few minutes and try again.')).toBeDefined()
    })
  })

  it('happy: "Send a new code" asks for one for this email and says so', async () => {
    resendOtpMock.mockResolvedValue({ message: 'If that account is waiting for verification, a new code is on its way.' })

    render(React.createElement(VerifyOtpPage))
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }))

    await waitFor(() => {
      expect(resendOtpMock).toHaveBeenCalledWith('owner@example.com')
      expect(screen.getByText('If that account is waiting for verification, a new code is on its way.')).toBeDefined()
    })
  })
})
