import { apiFetch } from './client'

export function getDigestSettings(workspaceId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/digest-settings`)
}

export function updateDigestSettings(
  workspaceId: string,
  input: { emailEnabled?: boolean; slackWebhookUrl?: string | null },
) {
  return apiFetch(`/api/workspaces/${workspaceId}/digest-settings`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function previewDigest(workspaceId: string) {
  return apiFetch(`/api/workspaces/${workspaceId}/digest-settings/preview`)
}
