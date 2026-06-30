import { apiFetch } from './client'

export function listKnowledgeBases(workspaceId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/knowledge-bases`)
}

export function createKnowledgeBase(workspaceId: string, name: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/knowledge-bases`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function deleteKnowledgeBase(workspaceId: string, kbId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/knowledge-bases/${kbId}`, {
    method: 'DELETE',
  })
}
