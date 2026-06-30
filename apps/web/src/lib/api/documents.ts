import { apiFetch, uploadFile } from './client'

export function listDocuments(workspaceId: string, kbId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/knowledge-bases/${kbId}/documents`)
}

export function uploadDocument(workspaceId: string, kbId: string, file: File) {
  return uploadFile(`/api/workspaces/${workspaceId}/knowledge-bases/${kbId}/documents`, file)
}

export function deleteDocument(workspaceId: string, kbId: string, documentId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/knowledge-bases/${kbId}/documents/${documentId}`, {
    method: 'DELETE',
  })
}
