import { apiFetch } from './client'

export function listKnowledgeBases(
  workspaceId: string,
  opts?: { cursor?: string; limit?: number },
) {
  const params = new URLSearchParams()
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const query = params.toString()

  return apiFetch(`/api/workspaces/${workspaceId}/knowledge-bases${query ? `?${query}` : ''}`)
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
