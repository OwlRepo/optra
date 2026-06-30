import { apiFetch } from './client'

type ScrapePayload = {
  url: string
  maxDepth?: number
  maxPages?: number
  includePrefixes?: string[]
}

export function scrapeSite(workspaceId: string, kbId: string, payload: ScrapePayload) {
  return apiFetch(`/api/workspaces/${workspaceId}/knowledge-bases/${kbId}/scrape`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function listScrapeRuns(workspaceId: string, kbId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/knowledge-bases/${kbId}/scrape-runs`)
}
