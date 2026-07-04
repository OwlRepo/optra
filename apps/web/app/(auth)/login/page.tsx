'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button, Card, Input, PageShell, StatusBanner } from '@repo/ui'
import { BrandMark } from '@/components/brand-mark'
import { login } from '@/lib/api/auth'
import { markLoggedIn } from '@/lib/auth'

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password required'),
})

type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setServerError(null)
    try {
      await login(data.email, data.password)
      markLoggedIn()
      router.push('/workspaces')
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : 'Login failed'
      setServerError(message)
    }
  }

  return (
    <PageShell contentClassName="flex min-h-screen items-center justify-center px-4 py-16">
      <Card variant="elevated" className="w-full max-w-sm space-y-6 p-8">
        <div className="space-y-4">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <BrandMark decorative className="size-9" />
            Mnemra
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              No account?{' '}
              <Link href="/register" className="text-primary underline-offset-4 hover:underline">
                Create one
              </Link>
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
            {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
            {errors.password ? <p className="text-xs text-destructive">{errors.password.message}</p> : null}
          </div>

          {serverError ? <StatusBanner variant="error" title={serverError} /> : null}

          <Button type="submit" className="w-full" size="lg" isLoading={isSubmitting} loadingText="Signing in">
            Sign in
          </Button>
        </form>
      </Card>
    </PageShell>
  )
}
