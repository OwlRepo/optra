import { apiFetch } from './client'

export function listWorkspaces(opts?: { cursor?: string; limit?: number }) {
  const params = new URLSearchParams()
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const query = params.toString()

  return apiFetch(`/api/workspaces${query ? `?${query}` : ''}`)
}

export function createWorkspace(name: string) {
  return apiFetch('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function getWorkspace(id: string) {
  return apiFetch(`/api/workspaces/${id}`)
}

export function inviteMember(id: string, email: string) {
  return apiFetch(`/api/workspaces/${id}/invite`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function acceptInvite(token: string) {
  return apiFetch(`/api/invitations/accept/${token}`, {
    method: 'POST',
  })
}

export function removeMember(id: string, userId: string) {
  return apiFetch(`/api/workspaces/${id}/members/${userId}`, {
    method: 'DELETE',
  })
}

export function listMembers(
  id: string,
  opts?: { page?: number; pageSize?: number; q?: string; role?: 'owner' | 'admin' | 'member' },
) {
  const params = new URLSearchParams()
  if (opts?.page) params.set('page', String(opts.page))
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  if (opts?.q) params.set('q', opts.q)
  if (opts?.role) params.set('role', opts.role)
  const query = params.toString()

  return apiFetch(`/api/workspaces/${id}/members${query ? `?${query}` : ''}`)
}
