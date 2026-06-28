const AT_KEY = 'mnemra_at'

export function setAccessToken(token: string): void {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(AT_KEY, token)
  }
}

export function getAccessToken(): string | null {
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem(AT_KEY)
  }
  return null
}

export function clearAccessToken(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(AT_KEY)
  }
}
