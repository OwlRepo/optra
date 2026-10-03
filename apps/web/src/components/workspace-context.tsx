'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useToast } from '@repo/ui'
import { getWorkspace } from '@/lib/api/workspaces'
import { isForbidden, isUnauthorized } from '@/lib/api/handle-unauthorized'
import { membershipFrom, type WorkspaceMembership } from '@/lib/workspace-role'

// The workspace header (name + the caller's role) for every page under
// /workspaces/[id]. Mounted by app/workspaces/[id]/layout.tsx: App Router keeps
// a layout mounted across sidebar navigations and remounts only the page, so
// this loads once per workspace instead of once per page. Pages load only
// their own data. Members calls refresh() (roles can change there); Settings
// calls setWorkspace() with the rename response.

export type WorkspaceSummary = { id: string; name: string; role?: string }
export type WorkspaceStatus = 'loading' | 'ready' | 'denied' | 'error'

export interface WorkspaceContextValue {
  workspace: WorkspaceSummary | null
  membership: WorkspaceMembership | null
  status: WorkspaceStatus
  refresh: () => Promise<void>
  setWorkspace: (workspace: WorkspaceSummary) => void
}

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ workspaceId, children }: { workspaceId: string; children?: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { toast } = useToast()
  const toastRef = React.useRef(toast)
  const [workspace, setWorkspaceState] = React.useState<WorkspaceSummary | null>(null)
  const [status, setStatus] = React.useState<WorkspaceStatus>('loading')
  // Only the latest request may write state, so a slow answer for a previous
  // workspace id never overwrites the current one.
  const requestRef = React.useRef(0)
  // A refresh that fails keeps the last good read instead of blanking the
  // header; only the first load of this workspace can land in 'error'.
  const loadedRef = React.useRef(false)

  React.useEffect(() => {
    toastRef.current = toast
  }, [toast])

  const refresh = React.useCallback(async () => {
    const request = ++requestRef.current
    try {
      const data = (await getWorkspace(workspaceId)) as WorkspaceSummary
      if (request !== requestRef.current) return
      loadedRef.current = true
      setWorkspaceState(data)
      setStatus('ready')
    } catch (err) {
      if (request !== requestRef.current) return
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      if (isForbidden(err)) {
        // Membership was revoked: drop the cached name and role.
        loadedRef.current = false
        setWorkspaceState(null)
        setStatus('denied')
        return
      }
      if (!loadedRef.current) {
        setWorkspaceState(null)
        setStatus('error')
      }
      toastRef.current({
        variant: 'error',
        title: 'Failed to load workspace',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      })
    }
  }, [router, workspaceId])

  React.useEffect(() => {
    loadedRef.current = false
    setWorkspaceState(null)
    setStatus('loading')
    void refresh()
  }, [refresh])

  // The layout never remounts, so a failed first load would otherwise stick
  // for the whole visit. The next page navigation retries it.
  const statusRef = React.useRef(status)
  statusRef.current = status
  const firstPathRef = React.useRef(pathname)
  React.useEffect(() => {
    if (pathname === firstPathRef.current) return
    firstPathRef.current = pathname
    if (statusRef.current === 'error') void refresh()
  }, [pathname, refresh])

  const setWorkspace = React.useCallback((next: WorkspaceSummary) => {
    // Supersedes any read still in flight, so an older GET cannot undo a rename.
    requestRef.current += 1
    loadedRef.current = true
    // Keep the known role when the response omits it (PATCH returns no role).
    setWorkspaceState((prev) => ({ ...next, role: next.role ?? prev?.role }))
    setStatus('ready')
  }, [])

  const value = React.useMemo<WorkspaceContextValue>(
    () => ({ workspace, membership: membershipFrom(workspace), status, refresh, setWorkspace }),
    [workspace, status, refresh, setWorkspace],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspaceContext(): WorkspaceContextValue {
  const ctx = React.useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspaceContext must be used inside <WorkspaceProvider>')
  return ctx
}
