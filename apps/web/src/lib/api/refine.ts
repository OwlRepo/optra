import { apiFetch } from './client'

export type RefineResult = { original: string; refined: string }
export type RefineStatus = { used: number; limit: number; remaining: number }
export type SavedRefinedMessage = {
  id: string
  originalText: string
  refinedText: string
  createdAt: string
}

export function refineMessage(workspaceId: string, text: string): Promise<RefineResult> {
  return apiFetch(`/api/workspaces/${workspaceId}/refine`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export function getRefineStatus(workspaceId: string): Promise<RefineStatus> {
  return apiFetch(`/api/workspaces/${workspaceId}/refine/status`)
}

export function saveRefinedMessage(
  workspaceId: string,
  input: { originalText: string; refinedText: string },
): Promise<SavedRefinedMessage> {
  return apiFetch(`/api/workspaces/${workspaceId}/refine/saved`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listSavedRefinedMessages(
  workspaceId: string,
): Promise<{ items: SavedRefinedMessage[] }> {
  return apiFetch(`/api/workspaces/${workspaceId}/refine/saved`)
}
