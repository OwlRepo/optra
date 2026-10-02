export function isUnauthorized(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false
  }

  const candidate = err as { statusCode?: unknown; message?: unknown }
  return candidate.statusCode === 401 || candidate.message === 'Unauthorized'
}

/**
 * A 403: the caller is signed in but may not open this workspace. On a
 * workspace page's first load that is WorkspaceMemberGuard (not a member, or
 * no such workspace); it is a "no access" state, never an empty one (B14).
 */
export function isForbidden(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false
  }

  return (err as { statusCode?: unknown }).statusCode === 403
}
