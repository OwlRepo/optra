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
  options?: {
    page?: number
    pageSize?: number
    q?: string
    status?: 'queued' | 'running' | 'completed' | 'failed'
  },
) {
  const search = new URLSearchParams()

  if (options?.page) {
    search.set('page', String(options.page))
  }

  if (options?.pageSize) {
    search.set('pageSize', String(options.pageSize))
  }

  if (options?.q) {
    search.set('q', options.q)
  }

  if (options?.status) {
    search.set('status', options.status)
  }

  const query = search.toString()

  return apiFetch(
    `/api/workspaces/${workspaceId}/knowledge-bases/${kbId}/scrape-runs${query ? `?${query}` : ''}`,
  )
}
