import { apiFetch } from './client'

type ScrapePayload = {
  url: string
  maxDepth?: number
  maxPages?: number
  includePrefixes?: string[]
}

type ScrapeRunResponse = {
  runId: string
  status: 'queued' | 'running'
  reusedExisting: boolean
}

export async function scrapeSite(workspaceId: string, kbId: string, payload: ScrapePayload): Promise<ScrapeRunResponse> {
  const res = await fetch(`/api/workspaces/${workspaceId}/knowledge-bases/${kbId}/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  if (!res.ok) throw data
  return {
    ...data,
    reusedExisting: res.status === 200,
  }
}

export function listScrapeRuns(
  workspaceId: string,
  kbId: string,
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
    `/api/workspaces/${workspaceId}/knowledge-bases/${kbId}/scrape-runs${query ? `?${query}` : ''}`,
  )
}
