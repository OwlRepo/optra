import { apiFetch, uploadFile } from './client'

export function listDocuments(
  workspaceId: string,
  kbId: string,
  opts?: { cursor?: string; limit?: number },
) {
  const params = new URLSearchParams()
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const query = params.toString()

  return apiFetch(
    `/api/workspaces/${workspaceId}/knowledge-bases/${kbId}/documents${query ? `?${query}` : ''}`,
  )
}

export function uploadDocument(workspaceId: string, kbId: string, file: File) {
  return uploadFile(`/api/workspaces/${workspaceId}/knowledge-bases/${kbId}/documents`, file)
}

export function deleteDocument(workspaceId: string, kbId: string, documentId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/knowledge-bases/${kbId}/documents/${documentId}`, {
    method: 'DELETE',
  })
}
