/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import VendorsPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const getWorkspaceMock = vi.fn()
const listWorkspacesMock = vi.fn()
const listVendorsMock = vi.fn()
const createVendorMock = vi.fn()
const logoutMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/workspaces/ws-1/vendors',
}))

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
  listWorkspaces: (...args: unknown[]) => listWorkspacesMock(...args),
}))

vi.mock('@/lib/api/catalog', () => ({
  listVendors: (...args: unknown[]) => listVendorsMock(...args),
  createVendor: (...args: unknown[]) => createVendorMock(...args),
}))

vi.mock('@/lib/api/auth', () => ({
  logout: (...args: unknown[]) => logoutMock(...args),
}))

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(VendorsPage, {
        params: { id: 'ws-1' },
      }),
    ),
  )
}

describe('VendorsPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    getWorkspaceMock.mockReset()
    listWorkspacesMock.mockReset()
    listVendorsMock.mockReset()
    createVendorMock.mockReset()
    logoutMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders loading skeleton before data resolves', async () => {
    let resolveVendors: (value: unknown) => void = () => {}
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listVendorsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveVendors = resolve
      }),
    )

    const { container } = renderPage()

    expect(container.querySelectorAll('[class*="bg-secondary"]').length).toBeGreaterThan(0)

    resolveVendors([])
    await screen.findByText('No vendors yet')
  })

  it('renders empty state with correct copy', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listVendorsMock.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText('No vendors yet')).toBeDefined()
    expect(screen.getByText('Add a vendor to start uploading or scraping their catalog.')).toBeDefined()
  })

  it('renders fetched vendors in a table', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listVendorsMock.mockResolvedValue([
      { id: 'vendor-1', name: 'Acme Supplies', contactInfo: 'orders@acme.com', createdAt: '2026-07-01T00:00:00.000Z' },
    ])

    renderPage()

    expect(await screen.findByText('Acme Supplies')).toBeDefined()
    expect(screen.getByText('orders@acme.com')).toBeDefined()
  })

  it('hides Add vendor action for member role and shows it for owner/admin', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listVendorsMock.mockResolvedValue([])
    listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'member' }], nextCursor: null })

    const view = renderPage()

    expect(await screen.findByText('No vendors yet')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Add vendor' })).toBeNull()

    view.unmount()

    listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'admin' }], nextCursor: null })
    renderPage()

    expect((await screen.findAllByRole('button', { name: 'Add vendor' })).length).toBeGreaterThan(0)
  })

  it('creates vendor from modal, shows success toast, and reloads the list', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listVendorsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'vendor-1', name: 'Acme Supplies', contactInfo: null, createdAt: '2026-07-01T00:00:00.000Z' }])
    createVendorMock.mockResolvedValue({ id: 'vendor-1', name: 'Acme Supplies' })

    renderPage()

    await screen.findByText('No vendors yet')
    fireEvent.click(screen.getAllByRole('button', { name: 'Add vendor' })[0] as HTMLButtonElement)
    fireEvent.change(screen.getByLabelText('Vendor name'), { target: { value: 'Acme Supplies' } })
    const submitButton = screen
      .getAllByRole('button', { name: 'Add vendor' })
      .find((button) => button.closest('form')) as HTMLButtonElement
    fireEvent.submit(submitButton.closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(createVendorMock).toHaveBeenCalledWith('ws-1', { name: 'Acme Supplies', contactInfo: undefined })
      expect(screen.getByText('Vendor added')).toBeDefined()
      expect(screen.getByText('Acme Supplies')).toBeDefined()
    })
  })

  it('shows error toast when creating vendor fails', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listVendorsMock.mockResolvedValue([])
    createVendorMock.mockRejectedValue({ message: 'Vendor name already exists' })

    renderPage()

    await screen.findByText('No vendors yet')
    fireEvent.click(screen.getAllByRole('button', { name: 'Add vendor' })[0] as HTMLButtonElement)
    fireEvent.change(screen.getByLabelText('Vendor name'), { target: { value: 'Acme Supplies' } })
    const submitButton = screen
      .getAllByRole('button', { name: 'Add vendor' })
      .find((button) => button.closest('form')) as HTMLButtonElement
    fireEvent.submit(submitButton.closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(screen.getByText('Failed to add vendor')).toBeDefined()
      expect(screen.getByText('Vendor name already exists')).toBeDefined()
    })
  })

  it('redirects to login on unauthorized load error', async () => {
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })
    listVendorsMock.mockResolvedValue([])

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })
})
