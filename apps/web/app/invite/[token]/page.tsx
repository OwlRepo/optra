'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, Card, PageShell, useToast } from '@repo/ui'
import { acceptInvite } from '@/lib/api/workspaces'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'

export default function InvitePage({ params }: { params: { token: string } }) {
  const router = useRouter()
  const { toast } = useToast()
  const [error, setError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const handleAccept = React.useCallback(async () => {
    try {
      setError(null)
      setIsSubmitting(true)
      const workspace = await acceptInvite(params.token)
      toast({
        variant: 'success',
        title: 'Workspace joined',
        description: `You now have access to ${workspace.name}.`,
      })
      router.push(`/workspaces/${workspace.id}/chat`)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }

      const message =
        err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Unable to accept invite.'

      setError(message)
      toast({
        variant: 'error',
        title: 'Invite could not be accepted',
        description: message,
      })
    } finally {
      setIsSubmitting(false)
    }
  }, [params.token, router, toast])

  return (
    <PageShell contentClassName="flex min-h-screen items-center py-16">
      <Card variant="elevated" className="mx-auto w-full max-w-lg space-y-6 p-8">
        <Badge variant="secondary" className="w-fit">
          Invitation
        </Badge>
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold">Join workspace?</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Accept the invitation to join the shared workspace and access its knowledge bases and documents.
          </p>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end">
          <Button onClick={() => void handleAccept()} isLoading={isSubmitting} loadingText="Joining">
            Join workspace
          </Button>
        </div>
      </Card>
    </PageShell>
  )
}
