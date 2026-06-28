import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.API_URL || 'http://localhost:3001'

export async function POST(request: NextRequest) {
  const rtCookie = request.cookies.get('mnemra_rt')

  if (rtCookie) {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `mnemra_rt=${rtCookie.value}`,
      },
    })
  }

  const response = NextResponse.json({ message: 'Logged out' })
  response.cookies.delete('mnemra_rt')
  return response
}
