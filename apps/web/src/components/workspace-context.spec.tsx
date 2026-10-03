/** @vitest-environment jsdom */

import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import { WorkspaceProvider, useWorkspaceContext } from './workspace-context'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const getWorkspaceMock = vi.fn()
let pathname = '/workspaces/ws-1'

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => pathname,
}))

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
}))

let latest: ReturnType<typeof useWorkspaceContext> | null = null

function Probe({ label = 'probe' }: { label?: string }) {
  const ctx = useWorkspaceContext()
  latest = ctx
  return (
    <div data-testid={label}>
      {ctx.status}|{ctx.workspace?.name ?? 'none'}|{ctx.membership?.role ?? 'none'}
    </div>
  )
}

function renderWith(workspaceId: string, child: React.ReactNode) {
  return render(
    <ToastProvider>
      <WorkspaceProvider workspaceId={workspaceId}>{child}</WorkspaceProvider>
    </ToastProvider>,
  )
}

describe('WorkspaceProvider', () => {
  beforeEach(() => {
    pushMock.mockReset()
    getWorkspaceMock.mockReset()
    pathname = '/workspaces/ws-1'
    latest = null
  })

  afterEach(() => {
    cleanup()
  })

  it('error: sends the caller to /login when the workspace load is unauthorized', async () => {
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })

    renderWith('ws-1', <Probe />)

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'))
  })

  it('error: reports denied when the caller is not a member of the workspace', async () => {
    getWorkspaceMock.mockRejectedValue({ statusCode: 403, message: 'Forbidden' })

    renderWith('ws-other', <Probe />)

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('denied|none|none'))
  })

  it('error: reports error and keeps no name when the load fails for another reason', async () => {
    getWorkspaceMock.mockRejectedValue(new Error('boom'))

    renderWith('ws-1', <Probe />)

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('error|none|none'))
  })

  it('error: a failed refresh keeps the cached name and role instead of wiping them', async () => {
    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Tyvera', role: 'owner' })
    renderWith('ws-1', <Probe />)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('ready|Tyvera|owner'))

    getWorkspaceMock.mockRejectedValueOnce({ statusCode: 500, message: 'Internal server error' })
    await act(async () => {
      await latest?.refresh()
    })

    expect(screen.getByTestId('probe').textContent).toBe('ready|Tyvera|owner')
  })

  it('error: the hook throws when used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow('useWorkspaceContext must be used inside <WorkspaceProvider>')
    spy.mockRestore()
  })

  it('edge: after a failed first load, the next page navigation retries it', async () => {
    getWorkspaceMock.mockRejectedValueOnce(new Error('blip'))
    const view = renderWith('ws-1', <Probe />)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('error|none|none'))

    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Tyvera', role: 'owner' })
    pathname = '/workspaces/ws-1/vendors'
    view.rerender(
      <ToastProvider>
        <WorkspaceProvider workspaceId="ws-1">
          <Probe />
        </WorkspaceProvider>
      </ToastProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('ready|Tyvera|owner'))
  })

  it('edge: a slow older read never overwrites a newer one', async () => {
    let resolveOld: (value: unknown) => void = () => {}
    getWorkspaceMock.mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
    renderWith('ws-1', <Probe />)

    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Newer', role: 'owner' })
    await act(async () => {
      await latest?.refresh()
    })
    await act(async () => {
      resolveOld({ id: 'ws-1', name: 'Older', role: 'member' })
    })

    expect(screen.getByTestId('probe').textContent).toBe('ready|Newer|owner')
  })

  it('edge: a rename lands after an in-flight read and is not overwritten by it', async () => {
    let resolveOld: (value: unknown) => void = () => {}
    getWorkspaceMock.mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
    renderWith('ws-1', <Probe />)

    act(() => {
      latest?.setWorkspace({ id: 'ws-1', name: 'Renamed', role: 'owner' })
    })
    await act(async () => {
      resolveOld({ id: 'ws-1', name: 'Old name', role: 'owner' })
    })

    expect(screen.getByTestId('probe').textContent).toBe('ready|Renamed|owner')
  })

  it('edge: a different workspace id loads that workspace and drops the old name', async () => {
    getWorkspaceMock.mockImplementation(async (id: string) => ({ id, name: id === 'ws-1' ? 'Alpha' : 'Beta', role: 'owner' }))

    const view = renderWith('ws-1', <Probe />)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('ready|Alpha|owner'))

    view.rerender(
      <ToastProvider>
        <WorkspaceProvider workspaceId="ws-2">
          <Probe />
        </WorkspaceProvider>
      </ToastProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('ready|Beta|owner'))
    expect(getWorkspaceMock).toHaveBeenLastCalledWith('ws-2')
  })

  it('regression: swapping the page under the provider keeps the name and does not refetch', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Tyvera', role: 'owner' })

    const view = renderWith('ws-1', <Probe label="overview" />)
    await waitFor(() => expect(screen.getByTestId('overview').textContent).toBe('ready|Tyvera|owner'))

    view.rerender(
      <ToastProvider>
        <WorkspaceProvider workspaceId="ws-1">
          <Probe key="vendors" label="vendors" />
        </WorkspaceProvider>
      </ToastProvider>,
    )

    // First render of the new page already has the name: no "Workspace" flash.
    expect(screen.getByTestId('vendors').textContent).toBe('ready|Tyvera|owner')
    expect(getWorkspaceMock).toHaveBeenCalledTimes(1)
  })

  it('happy: exposes the workspace name and the caller role from GET /workspaces/:id', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Tyvera', role: 'admin' })

    renderWith('ws-1', <Probe />)

    expect(screen.getByTestId('probe').textContent).toBe('loading|none|none')
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('ready|Tyvera|admin'))
    expect(getWorkspaceMock).toHaveBeenCalledWith('ws-1')
  })

  it('happy: setWorkspace updates the name without a fetch', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Tyvera', role: 'owner' })
    renderWith('ws-1', <Probe />)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('ready|Tyvera|owner'))

    act(() => {
      latest?.setWorkspace({ id: 'ws-1', name: 'Tyvera Renamed', role: 'owner' })
    })

    expect(screen.getByTestId('probe').textContent).toBe('ready|Tyvera Renamed|owner')
    expect(getWorkspaceMock).toHaveBeenCalledTimes(1)
  })

  it('happy: refresh refetches and picks up a changed role', async () => {
    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Tyvera', role: 'owner' })
    renderWith('ws-1', <Probe />)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('ready|Tyvera|owner'))

    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Tyvera', role: 'member' })
    await act(async () => {
      await latest?.refresh()
    })

    expect(screen.getByTestId('probe').textContent).toBe('ready|Tyvera|member')
    expect(getWorkspaceMock).toHaveBeenCalledTimes(2)
  })
})
