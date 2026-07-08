import { apiFetch } from './client'

export function listFreshnessFlags(workspaceId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/insights`)
}

export function dismissFreshnessFlag(workspaceId: string, flagId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/insights/${flagId}/dismiss`, {
    method: 'PATCH',
  })
}

export function listFaqDrafts(workspaceId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/insights/faq-drafts`)
}

export function approveFaqDraft(workspaceId: string, draftId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/insights/faq-drafts/${draftId}/approve`, {
    method: 'PATCH',
  })
}

export function rejectFaqDraft(workspaceId: string, draftId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/insights/faq-drafts/${draftId}/reject`, {
    method: 'PATCH',
  })
}

export function getCoverage(workspaceId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/insights/coverage`)
}
