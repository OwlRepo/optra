import { apiFetch } from './client'
import { clearLoggedIn } from '@/lib/auth'

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
  try {
    return await apiFetch('/api/auth/logout', { method: 'POST' })
  } finally {
    clearLoggedIn()
  }
}

export async function getCurrentUser(): Promise<{ userId: string; email: string }> {
  return apiFetch('/api/auth/me')
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return apiFetch('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}
