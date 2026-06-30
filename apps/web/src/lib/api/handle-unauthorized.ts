export function isUnauthorized(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false
  }

  const candidate = err as { statusCode?: unknown; message?: unknown }
  return candidate.statusCode === 401 || candidate.message === 'Unauthorized'
}
