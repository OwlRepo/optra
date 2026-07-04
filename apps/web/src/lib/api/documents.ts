import { apiFetch, uploadFile } from './client'
import { fetchDownload } from '../http/download'

export function listDocuments(
  workspaceId: string,
  kbId: string,
  opts?: {
    page?: number
    pageSize?: number
    q?: string
    status?: 'pending' | 'processing' | 'done' | 'failed'
  },
) {
  const params = new URLSearchParams()
  if (opts?.page) params.set('page', String(opts.page))
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  if (opts?.q) params.set('q', opts.q)
  if (opts?.status) params.set('status', opts.status)
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

export function downloadDocument(workspaceId: string, kbId: string, documentId: string) {
  return fetchDownload(
    `/api/workspaces/${workspaceId}/knowledge-bases/${kbId}/documents/${documentId}/download`,
    { method: 'GET' },
    'document',
  )
}

export function downloadDocuments(workspaceId: string, kbId: string, documentIds: string[]) {
  return fetchDownload(
    `/api/workspaces/${workspaceId}/knowledge-bases/${kbId}/documents/download`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentIds }),
    },
    'documents.zip',
  )
}
