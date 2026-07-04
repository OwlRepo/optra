import { apiFetch } from './client'

export function searchWorkspace(id: string, query: string, options?: { signal?: AbortSignal }) {
  const params = new URLSearchParams()
  params.set('q', query)

  return apiFetch(`/api/workspaces/${id}/search?${params.toString()}`, { signal: options?.signal })
}
