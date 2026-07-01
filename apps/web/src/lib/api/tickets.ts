import { apiFetch } from './client'

export function listTickets(workspaceId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/tickets`)
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
