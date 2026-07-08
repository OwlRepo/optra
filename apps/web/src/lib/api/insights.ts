import { apiFetch } from './client'

export function listFreshnessFlags(workspaceId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/insights`)
}

export function dismissFreshnessFlag(workspaceId: string, flagId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/insights/${flagId}/dismiss`, {
    method: 'PATCH',
  })
}
