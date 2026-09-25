'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button, Card, Input, PageShell, StatusBanner } from '@repo/ui'
import { BrandMark } from '@/components/brand-mark'
import { resendOtp, verifyOtp } from '@/lib/api/auth'
import { markLoggedIn } from '@/lib/auth'

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
  const [resendNotice, setResendNotice] = useState<string | null>(null)
  const [isResending, setIsResending] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setServerError(null)
    try {
      await verifyOtp(email, data.code)
      markLoggedIn()
      router.refresh()
      router.push('/chat')
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : 'Verification failed'
      setServerError(message)
    }
  }

  const onResend = async () => {
    setServerError(null)
    setResendNotice(null)
    setIsResending(true)
    try {
      const { message } = await resendOtp(email)
      setResendNotice(message)
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : 'Could not send a new code'
      setServerError(message)
    } finally {
      setIsResending(false)
    }
  }

  return (
    <PageShell contentClassName="flex min-h-screen items-center justify-center px-4 py-16">
      <Card variant="elevated" className="w-full max-w-sm space-y-6 p-8">
        <div className="space-y-4">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <BrandMark decorative className="size-9" />
            Optra
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">Check your email</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              We sent a 6-digit code to <strong>{email}</strong>
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="code" className="text-sm font-medium">
              Verification code
            </label>
            <Input
              id="code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              className="text-center text-lg tracking-widest"
              {...register('code')}
            />
            {errors.code ? <p className="text-xs text-destructive">{errors.code.message}</p> : null}
          </div>

          {serverError ? <StatusBanner variant="error" title={serverError} /> : null}
          {resendNotice ? <StatusBanner variant="success" title={resendNotice} /> : null}

          <Button type="submit" className="w-full" size="lg" isLoading={isSubmitting} loadingText="Verifying">
            Verify email
          </Button>
        </form>

        <Button
          type="button"
          variant="ghost"
          className="w-full"
          isLoading={isResending}
          loadingText="Sending"
          onClick={onResend}
        >
          Send a new code
        </Button>
      </Card>
    </PageShell>
  )
}
