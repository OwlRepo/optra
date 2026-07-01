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

export function listMembers(id: string, opts?: { cursor?: string; limit?: number }) {
  const params = new URLSearchParams()
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const query = params.toString()

  return apiFetch(`/api/workspaces/${id}/members${query ? `?${query}` : ''}`)
}
