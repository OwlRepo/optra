'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button, Card, Input, PageShell, StatusBanner } from '@repo/ui'
import { Sparkles } from 'lucide-react'
import { verifyOtp } from '@/lib/api/auth'
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
      router.push('/workspaces')
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : 'Verification failed'
      setServerError(message)
    }
  }

  return (
    <PageShell contentClassName="flex min-h-screen items-center justify-center px-4 py-16">
      <Card variant="elevated" className="w-full max-w-sm space-y-6 p-8">
        <div className="space-y-4">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-9 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
              <Sparkles className="size-4" />
            </span>
            Second Brain
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

          <Button type="submit" className="w-full" size="lg" isLoading={isSubmitting} loadingText="Verifying">
            Verify email
          </Button>
        </form>
      </Card>
    </PageShell>
  )
}
