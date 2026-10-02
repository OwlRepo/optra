'use client'

import { useRouter } from 'next/navigation'
import { Button, EmptyState } from '@repo/ui'
import { Lock } from 'lucide-react'

/**
 * Shown in place of a workspace page's content when its first load answers
 * 403 (B14): a stale or shared link, or a deleted workspace. Without it the
 * page fell through to its empty lists and looked like an empty workspace.
 */
export function WorkspaceAccessDenied() {
  const router = useRouter()

  return (
    <EmptyState
      icon={<Lock className="size-5" />}
      title="You don't have access to this workspace"
      description="It may have been deleted, or you are not a member. Ask its owner to invite you."
      actions={
        <Button size="sm" onClick={() => router.push('/workspaces')}>
          Go to your workspaces
        </Button>
      }
    />
  )
}
