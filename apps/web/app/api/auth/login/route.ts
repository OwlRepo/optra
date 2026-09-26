import { NextRequest, NextResponse } from 'next/server'
import { accessCookie, forwardSetCookies } from '../../../../src/lib/http/set-cookie'
import { clientIpHeaders } from '../../../../src/lib/http/client-ip'

const API_URL = process.env.API_URL || 'http://localhost:3001'

export async function POST(request: NextRequest) {
  const body = await request.json()

  const apiRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...clientIpHeaders(request.headers) },
    body: JSON.stringify(body),
  })

  const data = await apiRes.json()
  const response = NextResponse.json(data, { status: apiRes.status })
  const responseOk = (apiRes as Response & { ok?: boolean }).ok
  const isSuccess = typeof responseOk === 'boolean'
    ? responseOk
    : apiRes.status >= 200 && apiRes.status < 300

  forwardSetCookies(response, apiRes)

  if (isSuccess && data.accessToken) {
    response.headers.append('set-cookie', accessCookie(data.accessToken))
  }

  return response
}
