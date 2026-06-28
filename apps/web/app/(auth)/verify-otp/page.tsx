'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter, useSearchParams } from 'next/navigation'
import { verifyOtp } from '@/lib/api/auth'
import { setAccessToken } from '@/lib/auth'

const schema = z.object({
  code: z
    .string()
    .length(6, 'Code must be 6 digits')
    .regex(/^\d+$/, 'Code must be numeric'),
})

type FormData = z.infer<typeof schema>

export default function VerifyOtpPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = searchParams.get('email') ?? ''
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setServerError(null)
    try {
      const { accessToken } = await verifyOtp(email, data.code)
      setAccessToken(accessToken)
      router.push('/dashboard')
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : 'Verification failed'
      setServerError(message)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Check your email</h1>
          <p className="text-sm text-muted-foreground mt-1">
            We sent a 6-digit code to <strong>{email}</strong>
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label htmlFor="code" className="text-sm font-medium">
              Verification code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm tracking-widest text-center"
              {...register('code')}
            />
            {errors.code && (
              <p className="text-xs text-red-500 mt-1">{errors.code.message}</p>
            )}
          </div>

          {serverError && <p className="text-sm text-red-500">{serverError}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium disabled:opacity-50"
          >
            {isSubmitting ? 'Verifying…' : 'Verify email'}
          </button>
        </form>
      </div>
    </div>
  )
}
