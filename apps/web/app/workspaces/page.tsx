'use client'

// [support-surfaces-off] 2026-10-02: Knowledge Bases, Datasets, Chat, Tickets and
// Insights are hidden from the UI. Their pages, BFF routes, API and jobs still
// exist and are tested. To re-enable: uncomment every line tagged
// [support-surfaces-off] in this file and restore each "was:" value noted there.
// Repo checklist: grep -rn "support-surfaces-off" apps/web apps/e2e

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Badge,
  Button,
  EmptyState,
  Eyebrow,
  Input,
  Modal,
  SkeletonRows,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@repo/ui'
import { LogOut, Plus } from 'lucide-react'
import { BrandMark } from '@/components/brand-mark'
import { logout } from '@/lib/api/auth'
import { createWorkspace, listWorkspaces } from '@/lib/api/workspaces'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'

const schema = z.object({
  name: z.string().trim().min(1, 'Workspace name is required').max(255, 'Workspace name is too long'),
})

const CREATE_WORKSPACE_FORM_ID = 'create-workspace-form'

type Workspace = {
  id: string
  name: string
  role: string
  ownerId?: string
  createdAt?: string
}

type WorkspaceListResponse = {
  items: Workspace[]
  nextCursor: string | null
}

type FormData = z.infer<typeof schema>

function roleTone(role: string): 'teal' | 'neutral' {
  return role === 'owner' || role === 'admin' ? 'teal' : 'neutral'
}

export default function WorkspacesPage() {
  const router = useRouter()
  const { toast } = useToast()
  const toastRef = React.useRef(toast)
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([])
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [isLoadingMore, setIsLoadingMore] = React.useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  })

  React.useEffect(() => {
    toastRef.current = toast
  }, [toast])

  const loadWorkspaces = React.useCallback(async () => {
    try {
      setIsLoading(true)
      const data = await listWorkspaces()
      setWorkspaces(Array.isArray(data?.items) ? data.items : [])
      setNextCursor(data?.nextCursor ?? null)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }

      toastRef.current({
        variant: 'error',
        title: 'Failed to load workspaces',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      })
    } finally {
      setIsLoading(false)
    }
  }, [router])

  React.useEffect(() => {
    void loadWorkspaces()
  }, [loadWorkspaces])

  const handleLogout = React.useCallback(async () => {
    try {
      await logout()
    } finally {
      router.push('/login')
    }
  }, [router])

  const loadMoreWorkspaces = React.useCallback(async () => {
    if (!nextCursor) {
      return
    }

    try {
      setIsLoadingMore(true)
      const data = (await listWorkspaces({ cursor: nextCursor })) as WorkspaceListResponse
      setWorkspaces((current) => [...current, ...(Array.isArray(data?.items) ? data.items : [])])
      setNextCursor(data?.nextCursor ?? null)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }

      toastRef.current({
        variant: 'error',
        title: 'Failed to load more workspaces',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      })
    } finally {
      setIsLoadingMore(false)
    }
  }, [nextCursor, router])

  const onSubmit = handleSubmit(async (data) => {
    try {
      await createWorkspace(data.name)
      toast({
        variant: 'success',
        title: 'Workspace created',
        description: `${data.name} is ready.`,
      })
      reset()
      setIsModalOpen(false)
      await loadWorkspaces()
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }

      toast({
        variant: 'error',
        title: 'Failed to create workspace',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      })
    }
  })

  return (
    <div className="min-h-screen bg-background leading-[normal]">
      <header className="sticky top-0 z-40 border-b border-border bg-background/86 backdrop-blur-[16px]">
        <div className="mx-auto box-content flex max-w-[1040px] items-center justify-between gap-6 px-[clamp(20px,3.4vw,40px)] py-3.5">
          <Link href="/" aria-label="Home" className="flex items-center gap-2.5 text-foreground">
            <BrandMark decorative className="size-7" />
            <span className="font-display text-xl font-semibold tracking-[-0.04em]">Optra</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Log out"
              className="gap-2 px-2.5"
              onClick={() => {
                void handleLogout().catch(() => {})
              }}
            >
              <LogOut className="size-4" aria-hidden="true" />
              Log out
            </Button>
            <Button size="sm" className="gap-2" onClick={() => setIsModalOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New workspace
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto box-content max-w-[1040px] px-[clamp(20px,3.4vw,40px)] pb-16 pt-14">
        <Eyebrow rule>Tenant access</Eyebrow>
        <h1 className="mt-[18px] text-[42px] leading-[1.06]">Your workspaces</h1>
        <p className="mt-3.5 max-w-[56ch] text-[17px] leading-[1.65] text-ink-body">
          {/* [support-surfaces-off] was: Each workspace keeps its own knowledge bases, documents, and member permissions. (AppHeader description: Create a workspace, review your access, and jump into knowledge operations.) */}
          Each workspace keeps its own vendors, documents, and member permissions.
        </p>

        {isLoading ? (
          <div className="mt-9 overflow-hidden rounded-[18px] border border-border-panel bg-card">
            <SkeletonRows rows={3} columns={3} />
          </div>
        ) : workspaces.length === 0 ? (
          // [support-surfaces-off] was: description "Create your first workspace to start organizing knowledge."
          <EmptyState
            className="mt-9"
            label="Start here"
            title="No workspaces yet"
            description="Create your first workspace to start matching purchase orders."
          />
        ) : (
          <Table
            containerClassName="mt-9"
            footer={
              nextCursor ? (
                <div className="border-t border-border-inner bg-surface-subtle px-6 py-3.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadMoreWorkspaces()}
                    isLoading={isLoadingMore}
                    loadingText="Loading"
                    aria-label="Load more workspaces"
                  >
                    {!isLoadingMore ? 'Load more workspaces' : null}
                  </Button>
                </div>
              ) : undefined
            }
          >
            <TableHeader>
              <TableRow>
                <TableHead className="px-6">Name</TableHead>
                <TableHead className="w-[140px] px-3.5">Role</TableHead>
                <TableHead className="w-[120px] px-6 text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.map((workspace) => (
                <TableRow key={workspace.id} className="relative">
                  <TableCell className="px-6 py-3.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-primary-strong/10 font-display text-sm font-semibold text-primary-strong-hover"
                      >
                        {workspace.name.trim().charAt(0).toUpperCase() || 'W'}
                      </span>
                      <span className="truncate text-[16px] font-medium">{workspace.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="p-3.5">
                    <Badge variant={roleTone(workspace.role)} className="capitalize">
                      {workspace.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-6 py-3.5 text-right">
                    {/* [support-surfaces-off] was: href={`/workspaces/${workspace.id}/chat`} */}
                    <Link
                      href={`/workspaces/${workspace.id}/procurement`}
                      className="text-sm font-medium text-primary-strong transition-colors duration-200 after:absolute after:inset-0 hover:text-primary-strong-hover"
                    >
                      Open <span aria-hidden="true">→</span>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </main>

      <Modal
        open={isModalOpen}
        onClose={() => {
          if (!isSubmitting) {
            setIsModalOpen(false)
            reset()
          }
        }}
        title="Create workspace"
        eyebrow="New"
        footer={
          <div className="flex justify-end gap-2.5">
            <Button type="button" variant="ghost" className="px-3.5" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={CREATE_WORKSPACE_FORM_ID} isLoading={isSubmitting} loadingText="Creating">
              Create workspace
            </Button>
          </div>
        }
      >
        <form id={CREATE_WORKSPACE_FORM_ID} onSubmit={onSubmit}>
          <div className="flex flex-col gap-2">
            <label htmlFor="workspace-name" className="text-sm font-medium">
              Workspace name
            </label>
            <Input
              id="workspace-name"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'workspace-name-error' : undefined}
              className={errors.name ? 'border-destructive-tone' : undefined}
              {...register('name')}
            />
            {errors.name ? (
              <p id="workspace-name-error" className="text-[13px] text-destructive-strong-text">
                {errors.name.message}
              </p>
            ) : null}
          </div>
        </form>
      </Modal>
    </div>
  )
}
