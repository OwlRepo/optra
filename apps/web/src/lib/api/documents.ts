import { apiFetch, uploadFile } from './client'

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

function filenameFromDisposition(header: string | null, fallback: string) {
  const match = header?.match(/filename="?([^";]+)"?/i)
  return match?.[1] ?? fallback
}

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(href)
}

async function fetchDownload(path: string, init: RequestInit, fallbackFilename: string) {
  const response = await fetch(path, init)
  const blob = await response.blob()
  if (!response.ok) {
    throw { statusCode: response.status, message: 'Download failed' }
  }
  saveBlob(blob, filenameFromDisposition(response.headers.get('Content-Disposition'), fallbackFilename))
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
