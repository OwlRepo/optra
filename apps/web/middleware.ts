import { NextRequest, NextResponse } from 'next/server'
import { accessCookie } from './src/lib/http/set-cookie'

const API_URL = process.env.API_URL ?? 'http://localhost:3001'

/**
 * Calls the backend refresh endpoint directly.
 * Returns new accessToken + the rotated mnemra_rt Set-Cookie header, or null on failure.
 */
async function tryRefresh(
  rtValue: string,
): Promise<{ accessToken: string; rtSetCookie: string | null } | null> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `mnemra_rt=${rtValue}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.accessToken) return null
    return { accessToken: data.accessToken, rtSetCookie: res.headers.get('set-cookie') }
  } catch {
    return null
  }
}

export async function middleware(request: NextRequest) {
  const rt = request.cookies.get('mnemra_rt')
  const at = request.cookies.get('mnemra_at')

  // No refresh token → user never logged in (or explicitly logged out)
  if (!rt) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Refresh token present but access token cookie is gone (expired after 15 min).
  // Silently rotate: call backend refresh, update both cookies, let the request through.
  if (!at) {
    const refreshed = await tryRefresh(rt.value)
    if (!refreshed) {
      // Refresh token itself is expired/revoked → force re-login
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const response = NextResponse.next()
    // Forward the rotated mnemra_rt from the backend
    if (refreshed.rtSetCookie) {
      response.headers.append('set-cookie', refreshed.rtSetCookie)
    }
    // Issue the new short-lived access token cookie
    response.headers.append('set-cookie', accessCookie(refreshed.accessToken))
    return response
  }

  // Both cookies present — user is authenticated
  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/chat/:path*', '/workspaces/:path*', '/invite/:path*'],
}
