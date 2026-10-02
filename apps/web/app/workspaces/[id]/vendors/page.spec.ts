/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

// The modal's submit button lives in its footer (C13) and reaches the form
// through the `form` attribute, so the form is found through the button.
function addVendorSubmitButton(): HTMLButtonElement {
  return screen
    .getAllByRole('button', { name: 'Add vendor' })
    .find((button) => button.getAttribute('type') === 'submit') as HTMLButtonElement
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

  it('error: redirects to login on unauthorized load error', async () => {
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })
    listVendorsMock.mockResolvedValue([])

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('error: shows an error toast when creating a vendor fails', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listVendorsMock.mockResolvedValue([])
    createVendorMock.mockRejectedValue({ message: 'Vendor name already exists' })

    renderPage()

    await screen.findByText('No vendors yet')
    fireEvent.click(screen.getAllByRole('button', { name: 'Add vendor' })[0] as HTMLButtonElement)
    fireEvent.change(screen.getByLabelText('Vendor name'), { target: { value: 'Acme Supplies' } })
    fireEvent.submit(addVendorSubmitButton().form as HTMLFormElement)

    await waitFor(() => {
      expect(screen.getByText('Failed to add vendor')).toBeDefined()
      expect(screen.getByText('Vendor name already exists')).toBeDefined()
    })
  })

  // [RED] rewritten probe: C-0 skeletons no longer carry bg-secondary.
  it('edge: shows the loading skeleton as a busy region until vendors resolve', async () => {
    let resolveVendors: (value: unknown) => void = () => {}
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listVendorsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveVendors = resolve
      }),
    )

    const { container } = renderPage()

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()

    resolveVendors([])
    await screen.findByText('No vendors yet')
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('edge: members see the empty state without Add vendor; admins get it', async () => {
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

  // [RED] the fallback is not Mono today.
  it('edge: a vendor without createdAt reads "Recently created" in Mono, and no contact as a dash', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listVendorsMock.mockResolvedValue([{ id: 'vendor-1', name: 'Acme Supplies', contactInfo: null, createdAt: null }])

    renderPage()

    const created = await screen.findByText('Recently created')
    expect(created.className).toContain('font-mono')
    expect(screen.getByText('—')).toBeDefined()
  })

  // [RED] three per-cell links today.
  it('regression: each vendor row is a single link to its detail page with a trailing arrow', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listVendorsMock.mockResolvedValue([
      { id: 'vendor-1', name: 'Acme Supplies', contactInfo: 'orders@acme.com', createdAt: '2026-07-01T00:00:00.000Z' },
    ])

    renderPage()

    const row = (await screen.findByText('Acme Supplies')).closest('tr') as HTMLTableRowElement
    const links = within(row).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]?.textContent).toBe('Acme Supplies')
    expect(links[0]?.getAttribute('href')).toBe('/workspaces/ws-1/vendors/vendor-1')
    expect(within(row).getByText('→')).toBeDefined()
  })

  // [RED] label reads "Contact info" today.
  it('regression: the Add vendor modal marks contact info as optional', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listVendorsMock.mockResolvedValue([])

    renderPage()

    await screen.findByText('No vendors yet')
    fireEvent.click(screen.getAllByRole('button', { name: 'Add vendor' })[0] as HTMLButtonElement)

    expect(screen.getByLabelText('Contact info (optional)')).toBeDefined()
    expect(screen.getByLabelText('Vendor name')).toBeDefined()
  })

  it('happy: renders the empty state with its copy', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listVendorsMock.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText('No vendors yet')).toBeDefined()
    expect(screen.getByText('Add a vendor to start uploading or scraping their catalog.')).toBeDefined()
  })

  it('happy: renders fetched vendors in a table, created date as local ISO', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listVendorsMock.mockResolvedValue([
      { id: 'vendor-1', name: 'Acme Supplies', contactInfo: 'orders@acme.com', createdAt: new Date(2026, 6, 1, 12, 0).toISOString() },
    ])

    renderPage()

    expect(await screen.findByText('Acme Supplies')).toBeDefined()
    expect(screen.getByText('orders@acme.com')).toBeDefined()
    expect(screen.getByText('2026-07-01')).toBeDefined()
  })

  it('happy: creates a vendor from the modal, toasts success and reloads the list', async () => {
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
    fireEvent.submit(addVendorSubmitButton().form as HTMLFormElement)

    await waitFor(() => {
      expect(createVendorMock).toHaveBeenCalledWith('ws-1', { name: 'Acme Supplies', contactInfo: undefined })
      expect(screen.getByText('Vendor added')).toBeDefined()
      expect(screen.getByText('Acme Supplies')).toBeDefined()
    })
  })
})
