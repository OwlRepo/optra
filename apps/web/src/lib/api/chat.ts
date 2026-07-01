import { apiFetch } from './client'

export function listChatSessions(
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

  return apiFetch(`/api/workspaces/${workspaceId}/chat/sessions${query ? `?${query}` : ''}`)
}

export function getChatMessages(
  workspaceId: string,
  sessionId: string,
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

  return apiFetch(
    `/api/workspaces/${workspaceId}/chat/sessions/${sessionId}/messages${query ? `?${query}` : ''}`,
  )
}
