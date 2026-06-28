async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const data = await res.json()
  if (!res.ok) throw data
  return data
}

export async function register(email: string, password: string) {
  return apiFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function verifyOtp(email: string, code: string) {
  return apiFetch('/api/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  })
}

export async function login(email: string, password: string) {
  return apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function refreshAccessToken(): Promise<{ accessToken: string }> {
  return apiFetch('/api/auth/refresh', { method: 'POST' })
}

export async function logout() {
  return apiFetch('/api/auth/logout', { method: 'POST' })
}
