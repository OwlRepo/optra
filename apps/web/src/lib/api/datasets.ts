import { apiFetch, uploadFile } from './client'

export function listDatasets(workspaceId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/datasets`)
}

export function uploadDataset(workspaceId: string, file: File) {
  return uploadFile(`/api/workspaces/${workspaceId}/datasets`, file)
}

export function deleteDataset(workspaceId: string, datasetId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/datasets/${datasetId}`, {
    method: 'DELETE',
  })
}
