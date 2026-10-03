'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
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
  const { toast } = useToast()
  const toastRef = React.useRef(toast)
  const [workspace, setWorkspaceState] = React.useState<WorkspaceSummary | null>(null)
  const [status, setStatus] = React.useState<WorkspaceStatus>('loading')
  // Only the latest request may write state, so a slow answer for a previous
  // workspace id never overwrites the current one.
  const requestRef = React.useRef(0)

  React.useEffect(() => {
    toastRef.current = toast
  }, [toast])

  const refresh = React.useCallback(async () => {
    const request = ++requestRef.current
    try {
      const data = (await getWorkspace(workspaceId)) as WorkspaceSummary
      if (request !== requestRef.current) return
      setWorkspaceState(data)
      setStatus('ready')
    } catch (err) {
      if (request !== requestRef.current) return
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      setWorkspaceState(null)
      if (isForbidden(err)) {
        setStatus('denied')
        return
      }
      setStatus('error')
      toastRef.current({
        variant: 'error',
        title: 'Failed to load workspace',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      })
    }
  }, [router, workspaceId])

  React.useEffect(() => {
    setWorkspaceState(null)
    setStatus('loading')
    void refresh()
  }, [refresh])

  const setWorkspace = React.useCallback((next: WorkspaceSummary) => {
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
