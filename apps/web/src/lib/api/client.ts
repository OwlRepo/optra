const REFRESH_PATH = '/api/auth/refresh'
const UNAUTHENTICATED_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/verify-otp', REFRESH_PATH]

let refreshInFlight: Promise<boolean> | null = null

// mnemra_at (access token) expires after 15 min and is only silently refreshed by
// middleware.ts on page navigation — a client-side data fetch from an already-open
// page has no such refresh, so a bare 401 here doesn't necessarily mean the session
// (mnemra_rt) is actually invalid. Retry once through this shared refresh before
// treating it as a real logout. The promise is shared so concurrent 401s across
// multiple in-flight requests trigger exactly one refresh call, not one each.
function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(REFRESH_PATH, { method: 'POST' })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

async function parseJsonResponse(res: Response) {
  const isEmpty = res.status === 204 || res.status === 205
  return isEmpty ? {} : res.json()
}

export async function apiFetch(path: string, init?: RequestInit) {
  const requestInit = { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } }

  const res = await fetch(path, requestInit)
  const data = await parseJsonResponse(res)
  if (res.ok) return data

  if (res.status === 401 && !UNAUTHENTICATED_PATHS.includes(path)) {
    const refreshed = await refreshSession()
    if (refreshed) {
      const retryRes = await fetch(path, requestInit)
      const retryData = await parseJsonResponse(retryRes)
      if (retryRes.ok) return retryData
      throw retryData
    }
  }

  throw data
}

export async function uploadFile(path: string, file: File) {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(path, { method: 'POST', body: formData })
  const data = await res.json()
  if (res.ok) return data

  if (res.status === 401) {
    const refreshed = await refreshSession()
    if (refreshed) {
      const retryRes = await fetch(path, { method: 'POST', body: formData })
      const retryData = await retryRes.json()
      if (retryRes.ok) return retryData
      throw retryData
    }
  }

  throw data
}
