import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.API_URL || 'http://localhost:3001'
const ACCESS_TOKEN_MAX_AGE = 60 * 15 // 15 min — matches JWT_EXPIRY default

export async function POST(request: NextRequest) {
  const body = await request.json()

  const apiRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await apiRes.json()
  const response = NextResponse.json(data, { status: apiRes.status })

  const setCookie = apiRes.headers.get('set-cookie')
  if (setCookie) response.headers.set('set-cookie', setCookie)

  // Store access token in a short-lived httpOnly cookie so middleware can
  // verify session validity without decoding JWTs or hitting the database.
  if (apiRes.ok && data.accessToken) {
    response.cookies.set('mnemra_at', data.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: ACCESS_TOKEN_MAX_AGE,
    })
  }

  return response
}
