/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import SettingsPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const getWorkspaceMock = vi.fn()
const updateWorkspaceMock = vi.fn()
const logoutMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/workspaces/ws-1/settings',
}))

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
  updateWorkspace: (...args: unknown[]) => updateWorkspaceMock(...args),
}))

const changePasswordMock = vi.fn()

vi.mock('@/lib/api/auth', () => ({
  logout: (...args: unknown[]) => logoutMock(...args),
  changePassword: (...args: unknown[]) => changePasswordMock(...args),
}))

const getDigestSettingsMock = vi.fn()
const updateDigestSettingsMock = vi.fn()
const previewDigestMock = vi.fn()

vi.mock('@/lib/api/digest-settings', () => ({
  getDigestSettings: (...args: unknown[]) => getDigestSettingsMock(...args),
  updateDigestSettings: (...args: unknown[]) => updateDigestSettingsMock(...args),
  previewDigest: (...args: unknown[]) => previewDigestMock(...args),
}))

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(SettingsPage, {
        params: { id: 'ws-1' },
      }),
    ),
  )
}

function asMember() {
  getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme Support', role: 'member' })
}

describe('SettingsPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    getWorkspaceMock.mockReset()
    updateWorkspaceMock.mockReset()
    logoutMock.mockReset()
    changePasswordMock.mockReset()
    getDigestSettingsMock.mockReset()
    updateDigestSettingsMock.mockReset()
    previewDigestMock.mockReset()
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme Support', role: 'owner' })
    getDigestSettingsMock.mockResolvedValue({ emailEnabled: true, slackWebhookUrl: null, slackEnabled: false })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('error: redirects to login on unauthorized load error', async () => {
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('error: blocks submit client-side for an empty name and does not call the API', async () => {
    renderPage()

    const input = await screen.findByLabelText('Workspace name')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Workspace name is required')).toBeDefined()
    expect(updateWorkspaceMock).not.toHaveBeenCalled()
  })

  it('error: blocks submit client-side for a too-long name and does not call the API', async () => {
    renderPage()

    const input = await screen.findByLabelText('Workspace name')
    fireEvent.change(input, { target: { value: 'x'.repeat(256) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Workspace name is too long')).toBeDefined()
    expect(updateWorkspaceMock).not.toHaveBeenCalled()
  })

  it('error: blocks change-password submit client-side when confirm does not match', async () => {
    renderPage()

    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'old-pass' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpassword123' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'does-not-match' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Passwords do not match')).toBeDefined()
    expect(changePasswordMock).not.toHaveBeenCalled()
  })

  it('error: blocks change-password submit client-side for a new password under 8 characters', async () => {
    renderPage()

    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'old-pass' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Password must be at least 8 characters')).toBeDefined()
    expect(changePasswordMock).not.toHaveBeenCalled()
  })

  it('error: shows an inline error and does not log out when the current password is wrong', async () => {
    changePasswordMock.mockRejectedValue({ statusCode: 401, message: 'Current password is incorrect' })

    renderPage()

    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'wrong-pass' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpassword123' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'newpassword123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Current password is incorrect')).toBeDefined()
    expect(logoutMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalledWith('/login')
  })

  // [RED] no switch exists today.
  it('error: a failed digest toggle toasts and leaves the switch where it was', async () => {
    updateDigestSettingsMock.mockRejectedValue(new Error('Digest service down'))

    renderPage()

    fireEvent.click(await screen.findByRole('switch', { name: 'Email digest' }))

    expect(await screen.findByText('Failed to update digest settings')).toBeDefined()
    expect(screen.getByText('Digest service down')).toBeDefined()
    expect(screen.getByRole('switch', { name: 'Email digest' }).getAttribute('aria-checked')).toBe('true')
  })

  // [RED] amber 3.11: the helper line is new.
  it('edge: a plain member sees the rename field disabled, no save button, and why', async () => {
    asMember()

    renderPage()

    const input = await screen.findByLabelText('Workspace name')
    expect((input as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(await screen.findByText('Only owners and admins can rename the workspace.')).toBeDefined()
  })

  it('edge: owners do not see the member-only rename helper', async () => {
    renderPage()

    await screen.findByRole('button', { name: 'Save changes' })
    expect(screen.queryByText('Only owners and admins can rename the workspace.')).toBeNull()
  })

  it('edge: does not fetch digest settings for a plain member', async () => {
    asMember()

    renderPage()

    await screen.findByLabelText('Workspace name')
    expect(getDigestSettingsMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Weekly digest')).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Email digest' })).toBeNull()
  })

  // [RED] rewrites the On/Off button case (C-2): same handler, now role="switch".
  it('regression: the email digest is a switch whose aria-checked follows the saved setting', async () => {
    updateDigestSettingsMock.mockResolvedValue({ emailEnabled: false, slackWebhookUrl: null, slackEnabled: false })

    renderPage()

    const toggle = await screen.findByRole('switch', { name: 'Email digest' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(updateDigestSettingsMock).toHaveBeenCalledWith('ws-1', { emailEnabled: false })
    })
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Email digest' }).getAttribute('aria-checked')).toBe('false')
    })
    expect(screen.getByText('Digest settings updated')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'On' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Off' })).toBeNull()
  })

  // [RED] the ID sits in a CardDescription sentence today.
  it('regression: the workspace ID reads as a definition row', async () => {
    renderPage()

    expect(await screen.findByText('Workspace ID')).toBeDefined()
    expect(screen.getByText('ws-1')).toBeDefined()
    expect(screen.queryByText('Workspace ID: ws-1')).toBeNull()
  })

  // [RED] no status dot today.
  it('regression: the Slack status carries a teal dot once posting is enabled', async () => {
    getDigestSettingsMock.mockResolvedValue({
      emailEnabled: true,
      slackWebhookUrl: 'https://hooks.slack.com/services/x',
      slackEnabled: true,
    })

    renderPage()

    const status = await screen.findByText('Slack posting is enabled.')
    expect(status.querySelector('span[aria-hidden="true"]')).not.toBeNull()
  })

  // [RED] the preview is a plain bordered <pre> today.
  it('regression: the digest preview renders as plain text in a Mono well', async () => {
    previewDigestMock.mockResolvedValue({
      emailHtml: '<h2>digest</h2>',
      slackPayload: { text: 'Quiet week — nothing notable.' },
    })

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Preview digest' }))

    const preview = await screen.findByText('Quiet week — nothing notable.')
    expect(preview.tagName).toBe('PRE')
    expect(preview.className).toContain('font-mono')
  })

  it('happy: renders the current workspace name in the rename field', async () => {
    renderPage()

    expect(await screen.findByDisplayValue('Acme Support')).toBeDefined()
  })

  it('happy: an owner sees an editable rename form and can submit a new name', async () => {
    updateWorkspaceMock.mockResolvedValue({
      id: 'ws-1',
      name: 'Renamed Co',
      ownerId: 'u-1',
      createdAt: '',
    })

    renderPage()

    const input = await screen.findByLabelText('Workspace name')
    fireEvent.change(input, { target: { value: 'Renamed Co' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(updateWorkspaceMock).toHaveBeenCalledWith('ws-1', 'Renamed Co')
      expect(screen.getByText('Workspace renamed')).toBeDefined()
    })
  })

  it('happy: an admin sees an editable rename form', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme Support', role: 'admin' })

    renderPage()

    const input = await screen.findByLabelText('Workspace name')
    expect((input as HTMLInputElement).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDefined()
  })

  it('happy: logs out and redirects to login', async () => {
    logoutMock.mockResolvedValue(undefined)

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }))

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1)
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('happy: changes the password, toasts, logs out and redirects to login', async () => {
    changePasswordMock.mockResolvedValue({ message: 'Password changed. Please log in again.' })
    logoutMock.mockResolvedValue(undefined)

    renderPage()

    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'old-pass' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpassword123' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'newpassword123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    await waitFor(() => {
      expect(changePasswordMock).toHaveBeenCalledWith('old-pass', 'newpassword123')
      expect(logoutMock).toHaveBeenCalledTimes(1)
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('happy: saves a Slack webhook URL', async () => {
    updateDigestSettingsMock.mockResolvedValue({
      emailEnabled: true,
      slackWebhookUrl: 'https://hooks.slack.com/services/x',
      slackEnabled: true,
    })

    renderPage()

    fireEvent.change(await screen.findByLabelText('Slack webhook URL'), {
      target: { value: 'https://hooks.slack.com/services/x' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateDigestSettingsMock).toHaveBeenCalledWith('ws-1', {
        slackWebhookUrl: 'https://hooks.slack.com/services/x',
      })
    })
    expect(await screen.findByText('Slack posting is enabled.')).toBeDefined()
  })

  describe('no access (B18)', () => {
    const denied = { statusCode: 403, message: 'Not a member of this workspace' }

    it('error: a non-member sees the no-access state, not an error toast', async () => {
      getWorkspaceMock.mockRejectedValue(denied)

      renderPage()

      expect(await screen.findByRole('heading', { name: "You don't have access to this workspace" })).toBeDefined()
      expect(screen.queryByText('Failed to load workspace')).toBeNull()
      expect(pushMock).not.toHaveBeenCalledWith('/login')
    })

    it('edge: a failure that is not a 403 still shows the error toast', async () => {
      getWorkspaceMock.mockRejectedValue({ statusCode: 500, message: 'Internal server error' })

      renderPage()

      expect(await screen.findByText('Failed to load workspace')).toBeDefined()
      expect(screen.queryByRole('heading', { name: "You don't have access to this workspace" })).toBeNull()
    })
  })
})
