import { apiFetch } from './client'
import { fetchDownload } from '../http/download'

export function listTickets(
  workspaceId: string,
  options?: {
    page?: number
    pageSize?: number
    q?: string
    status?: 'pending' | 'processing' | 'done' | 'failed'
    severity?: 'low' | 'medium' | 'high'
    usefulness?: 'useful' | 'not_useful'
    indexed?: 'true' | 'false'
  },
) {
  const search = new URLSearchParams()

  if (options?.page) search.set('page', String(options.page))
  if (options?.pageSize) search.set('pageSize', String(options.pageSize))
  if (options?.q) search.set('q', options.q)
  if (options?.status) search.set('status', options.status)
  if (options?.severity) search.set('severity', options.severity)
  if (options?.usefulness) search.set('usefulness', options.usefulness)
  if (options?.indexed) search.set('indexed', options.indexed)

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

export function downloadTicketTranscript(workspaceId: string, ticketId: string) {
  return fetchDownload(
    `/api/workspaces/${workspaceId}/tickets/${ticketId}/transcript.pdf`,
    { method: 'GET' },
    'transcript.pdf',
  )
}
