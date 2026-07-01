import { apiFetch } from './client'

export function listTickets(
  workspaceId: string,
  options?: { cursor?: string; limit?: number },
) {
  const search = new URLSearchParams()

  if (options?.cursor) {
    search.set('cursor', options.cursor)
  }

  if (options?.limit) {
    search.set('limit', String(options.limit))
  }

  const query = search.toString()

  return apiFetch(`/api/workspaces/${workspaceId}/tickets${query ? `?${query}` : ''}`)
}

export function createTicket(workspaceId: string, body: { transcript: string }) {
  return apiFetch(`/api/workspaces/${workspaceId}/tickets`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getTicket(workspaceId: string, ticketId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/tickets/${ticketId}`)
}

export function updateTicket(
  workspaceId: string,
  ticketId: string,
  body: Record<string, unknown>,
) {
  return apiFetch(`/api/workspaces/${workspaceId}/tickets/${ticketId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
