import { apiFetch } from './client'

export function listEvents(id: string, opts?: { cursor?: string; limit?: number }) {
  const params = new URLSearchParams()
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const query = params.toString()

  return apiFetch(`/api/workspaces/${id}/events${query ? `?${query}` : ''}`)
}

export function getUnreadCount(id: string) {
  return apiFetch(`/api/workspaces/${id}/events/unread-count`)
}

export function markEventsSeen(id: string) {
  return apiFetch(`/api/workspaces/${id}/events/mark-seen`, {
    method: 'POST',
  })
}
