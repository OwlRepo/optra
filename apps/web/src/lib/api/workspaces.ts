import { apiFetch } from './client'

export function listWorkspaces() {
  return apiFetch('/api/workspaces')
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
